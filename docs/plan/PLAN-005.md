# PLAN-005 重构 Worktree 系统

- **status**: proposed
- **task**: WT-001
- **owner**: claude
- **created**: 2026-03-02

## 背景

当前 worktree 系统存在 5 个核心问题：目录位置在仓库内部、路径未持久化到数据库、默认不启用、状态转换时缺少生命周期管理、文件变更跟踪使用主仓库而非 worktree 目录。

## 调查发现

### 现状架构

- **目录位置**: `<baseDir>/.bitk/worktrees/<issueId>` — 在仓库 `.bitk/` 子目录下
- **常量**: `WORKTREE_DIR = '.bitk/worktrees'` (constants.ts)
- **路径构造**: `join(baseDir, WORKTREE_DIR, issueId)` (worktree.ts)
- **DB 字段**: `useWorktree: boolean` — 仅有开关，无路径存储
- **默认值**: `useWorktree = false`（schema.ts、create route、前端 useState）
- **生命周期**: 仅在 execute/followUp/restart 时创建，无清理逻辑
- **文件跟踪**: `changes.ts` 路由始终使用 `resolveProjectDir()` 返回的主仓库目录

### 关键调用链

1. **创建**: `createWorktree(baseDir, issueId)` → `git worktree add -b bitk/<issueId> <dir>`
2. **使用位置**: `execute.ts`、`spawn.ts:spawnFollowUpProcess`、`restart.ts`
3. **内存跟踪**: `ManagedProcess.worktreePath` — 仅运行时保持，重启丢失
4. **文件变更**: `changes.ts:resolveProjectDir(projectId)` → 始终返回 `project.directory || cwd()`
5. **状态转换**: `update.ts` 处理 done→cancel，但不处理 worktree 清理

### 涉及文件清单

**后端**:
- `apps/api/src/db/schema.ts` — 添加 worktreeDir 字段
- `apps/api/drizzle/` — 新迁移文件
- `apps/api/src/engines/issue/constants.ts` — 修改 WORKTREE_DIR 常量
- `apps/api/src/engines/issue/utils/worktree.ts` — 重写路径构造
- `apps/api/src/engines/issue/orchestration/execute.ts` — 持久化 worktreeDir
- `apps/api/src/engines/issue/lifecycle/spawn.ts` — 使用 DB 中的 worktreeDir
- `apps/api/src/engines/issue/orchestration/restart.ts` — 使用 DB 中的 worktreeDir
- `apps/api/src/engines/issue/lifecycle/settle.ts` — 清理逻辑（已在本 worktree 添加）
- `apps/api/src/engines/issue/gc.ts` — 清理逻辑（已在本 worktree 添加）
- `apps/api/src/engines/issue/process/cancel.ts` — 清理逻辑（已在本 worktree 添加）
- `apps/api/src/engines/engine-store.ts` — updateIssueSession 添加 worktreeDir
- `apps/api/src/routes/issues/update.ts` — 状态转换时管理 worktree
- `apps/api/src/routes/issues/changes.ts` — 使用 worktreeDir
- `apps/api/src/routes/issues/create.ts` — 默认 useWorktree=true
- `apps/api/src/routes/issues/_shared.ts` — serializeIssue 输出 worktreeDir

**前端**:
- `apps/frontend/src/components/kanban/CreateIssueDialog.tsx` — 默认 true
- `packages/shared/src/index.ts` — Issue 类型添加 worktreeDir

## 方案

### 步骤 1: DB 迁移

- `issues` 表新增 `worktree_dir TEXT` 列（可空，无 worktree 时为 null）
- `useWorktree` 默认值改为 `true`

### 步骤 2: Worktree 路径重构

- 常量 `WORKTREE_DIR` 改为 `data/worktrees`
- 新路径: `<ROOT_DIR>/data/worktrees/<projectId>/<issueId>/`
- `createWorktree(baseDir, projectId, issueId)` 签名变更
- `cleanupWorktree` 简化为读取 DB 中的 worktreeDir + baseDir

### 步骤 3: 持久化 worktreeDir

- `execute.ts`: 创建 worktree 后调用 `updateIssueWorktreeDir(issueId, path)`
- `spawnFollowUpProcess`: 从 DB 读取 `worktreeDir` 而非拼接路径
- `restart.ts`: 同上

### 步骤 4: 状态转换生命周期

在 `update.ts`（单个 + 批量）中：
- **→ done**: 清理 worktree（调用 `removeWorktree`），清空 DB `worktreeDir`
- **→ working**: 确保 worktree 存在（ensure）— 仅当 `useWorktree && worktreeDir 目录不存在` 时才创建并持久化，已存在则跳过
- **→ review**: 保留 worktree（不清理）

### 步骤 5: 文件变更跟踪

- `changes.ts`: 如果 issue 有 `worktreeDir`，使用该目录代替 `resolveProjectDir()`
- 同时影响 `listChangedFiles`、`summarizeFileLines`、`isGitRepo` 的 cwd 参数

### 步骤 6: 前端 + 共享类型

- `Issue` 类型添加 `worktreeDir: string | null`
- `CreateIssueDialog`: `useState(true)` 默认启用
- `serializeIssue`: 输出 worktreeDir

## 风险

1. **迁移兼容性**: 已有 issues 的 `useWorktree=false` 不受新默认值影响
2. **路径变更**: 旧路径 `.bitk/worktrees/` 下的 worktree 需要手动清理或忽略
3. **Git 命令 cwd**: `removeWorktree` 的 cwd 必须是主仓库目录，新路径在 `data/` 下也能正常工作因为 git worktree remove 接受绝对路径
4. **重启恢复**: 有了 DB 持久化的 worktreeDir，reconciler 可在启动时清理孤儿 worktree

## 范围

约 15 个文件变更，1 个新迁移文件。不改变 engine executor 接口，不影响前端路由。
