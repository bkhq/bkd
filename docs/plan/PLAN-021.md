---
id: PLAN-021
title: One-click fork current issue into a new spawned issue
status: completed
created: 2026-05-19
approvedAt: 2026-05-20
completedAt: 2026-05-20
relatedTask: FORK-001
---

# PLAN-021 — One-click fork current issue into a new spawned issue

## Context

- 用户在长会话里常想把一个子任务「外挂」出去:既不占用当前会话,
  又不阻塞主任务,在新 issue 里独立执行。
- `issues.parentIssueId` 字段 + `issues_parent_issue_id_idx` 索引已存在
  (`apps/api/src/db/schema.ts:57`),目前没有 UI 入口写入。
- BKD 每个 issue 的 worktree 路径按 issueId 写死
  (`resolveWorktreePath(projectId, issueId)`),分支 `bkd/<issueId>`,
  且 `createWorktree` 刻意从 `origin/main` 起步、拒绝用 HEAD。
- 进程层面 issue 之间天然并行(`ProcessManager` 按 issueId 分组),
  主任务与 fork 出的子任务可同时执行,互不阻塞 —— 唯一冲突点是
  工作目录,因此并行的子任务必须各自拥有独立 worktree。
- 关键洞察:一个持续依赖「另一任务还在改的工作树」的任务无法真并行。
  因此 fork 按「对当前改动的依赖程度」分三种模式,由用户在弹窗中选择。

## Fork modes

| mode | worktree | 何时执行 | 适用 |
|------|----------|----------|------|
| `independent` | 新 worktree,从 `origin/main` | 立即并行 | 侧任务不依赖当前改动 |
| `snapshot` | 新 worktree + `git stash` 快照导入父 WIP | 立即并行 | 侧任务依赖当前**未提交改动**(取一次快照) |
| `dependent` | 主任务 settle 后,从父分支起 worktree | 父 issue settle 时自动开跑 | 侧任务依赖主任务**这轮的最终成果** |

- `independent` / `snapshot` 立即创建 `working` 子 issue 并执行。
- `dependent` 创建 `todo` 子 issue,`sessionStatus` 留空,新增标记
  `forkAwaitingParent=1`;父 issue settle 时由 settlement 钩子触发执行。

## Proposal

### Backend

1. **迁移 `0022_issue_fork_await.sql`**
   - `ALTER TABLE issues ADD COLUMN fork_awaiting_parent INTEGER NOT NULL DEFAULT 0`。
   - schema.ts 同步加 `forkAwaitingParent: integer(...).notNull().default(0)`。
   - `parentIssueId` 已存在,无需新增。

2. **派生上下文构造** `apps/api/src/services/fork-context.ts`(新):
   - `buildForkContext({ parentIssueId, instruction, includeHistory })`
   - `includeHistory` 关:prompt = 父 issue 标题 + 最后一条 user 消息 +
     最近一条 assistant 消息文本(~30 行)+ 用户填写的 `instruction`。
   - `includeHistory` 开:逆序按 turn 拉 `issues_logs`(visible=1,
     user/assistant 类型),拼接并截断到 ~8k 字符,再接 `instruction`。
   - 返回 `{ title, prompt }`,`title = '↳ ' + parent.title`(截断 80 字)。
   - 不做 LLM 摘要(避免新增 token 成本/延迟;后续可加)。

3. **快照服务** `apps/api/src/services/worktree-carry.ts`(新,仅 `snapshot` 用):
   - `snapshotDirty(parentWorkingDir)` — 在父工作目录跑
     `git stash create -u`(含 untracked,不改 working tree),返回 sha
     或 null(clean)。
   - `applySnapshot(childWorktreeDir, sha)` — 子 worktree 内
     `git stash apply <sha>`;失败回退 `git diff <sha>^..<sha>` →
     `git apply -3`。失败不致命,记入响应 `carryWarning`。
   - 父工作目录全程零修改;最坏情况是子侧 apply 失败,父侧完好。

4. **新端点** `POST /api/projects/:projectId/issues/:id/fork`,Zod body:
   ```ts
   {
     instruction: z.string().min(1).max(8000),
     mode: z.enum(['independent', 'snapshot', 'dependent']),
     includeHistory: z.boolean().optional(),   // default false
     inheritEngine: z.boolean().optional(),    // default true
     autoExecute: z.boolean().optional(),      // default true(对 dependent 无效)
   }
   ```
   handler 逻辑:
   - 校验父 issue 属于该 project。
   - `mode='snapshot'` 时:父 `sessionStatus` 为 `running`/`pending` 仍允许
     (快照只读),但若父无可用工作目录则降级为 `independent` 并加 warning。
   - 用 `buildForkContext` 造 title/prompt;`inheritEngine` 决定
     engineType/model 取父值还是默认。
   - 复用 create.ts 的 issueNumber/sortOrder 计算,插入子 issue,写
     `parentIssueId`;`dependent` → statusId=`todo` + `forkAwaitingParent=1`;
     其余 → statusId=`working`。
   - 写父 issue 一条 `system-message` log(metadata `{kind:'fork-out',
     childIssueId, mode}`);写子 issue 一条 `system-message`
     (`{kind:'fork-in', parentIssueId, mode}`)。
   - `independent`/`snapshot` 且 `autoExecute`:走 `triggerIssueExecution`。
     `snapshot` 在子 worktree 创建后、执行前调用 `applySnapshot`。
   - 返回 `{ issue, parentIssueId, mode, carryWarning? }`。

5. **依赖接力触发** —— 在 issue settlement 钩子里(`engines/issue/lifecycle/
   settle.ts` 完成后,或 `reconciler` settle 回调)新增:
   - settle 完成后查 `issues WHERE parentIssueId=<settledId> AND
     forkAwaitingParent=1 AND isDeleted=0`。
   - 对每个:清 `forkAwaitingParent=0`,statusId→`working`,走
     `triggerIssueExecution`。子 worktree 此时从父分支 `bkd/<parentId>`
     起步(子 issue 仍用自己的 worktree 路径,但 `createWorktree` 的
     startPoint 改为「父分支若存在则用父分支,否则 origin/main」)。
   - 为支持上一条,`createWorktree` 增加可选 `startPointRef` 参数;
     fork 的 dependent 路径传 `bkd/<parentIssueId>`。

6. **查询扩展** `routes/issues/query.ts` — 单 issue 响应附
   `parentIssueId` + `forks: { id, issueNumber, title, statusId }[]`
   (子 issue 轻量列表)。`serializeIssue` 增补 `parentIssueId`。

### Frontend

1. **入口** `components/issue-detail/` TopBar overflow 菜单新增
   「分流到新 issue」(`chat.fork.cta`),桌面 + 移动同一菜单,
   快捷键 `⌘⇧F`。

2. **`ForkDialog.tsx`(新)**:
   - 多行必填「侧任务指令」。
   - 模式三选一 radio(独立 / 依赖当前未提交改动 / 依赖主任务最终成果),
     每项配一行说明文案。
   - 复选:`携带对话历史`、`继承 engine/model`(默认勾选)。
   - 「创建并执行」/「仅创建」按钮。
   - 所有控件移动端 ≥44px。

3. **API client + hook**:
   - `kanban-api.ts` 加 `forkIssue(projectId, issueId, payload)`。
   - `use-kanban.ts` 加 `useForkIssue()`;成功后失效 issues 查询,
     `dependent` 模式 toast「已排期,主任务完成后自动开始」并停留;
     其余 toast「侧任务已启动」+ `navigate` 到新 issue。

4. **血缘 chip**:IssueDetail 顶栏标题旁,有 `parentIssueId` 渲染
   `↗ from #N`,有 `forks` 渲染 `↳ N forks`,点击互跳。复用 chip-surface。

5. **i18n** — `chat.fork.*` 键(en + zh):`cta`, `dialog.title`,
   `dialog.instruction`, `dialog.mode.independent/snapshot/dependent`
   (各含 `.desc`), `dialog.includeHistory`, `dialog.inheritEngine`,
   `submit`, `submitAndRun`, `toast.started`, `toast.scheduled`,
   `lineage.from`, `lineage.forks`.

### Tests

| # | Test | 实现 |
|---|------|------|
| 1 | `apps/api/test/issue-fork.test.ts` — independent 模式创建子 issue,parentIssueId 正确,父/子双向 system-message | route + service |
| 2 | 同上:dependent 模式建 todo 子 issue 且 forkAwaitingParent=1,不立即执行 | route |
| 3 | `apps/api/test/fork-dependent-settle.test.ts` — 父 issue settle 后子 issue 自动转 working 并触发执行 | settlement 钩子 |
| 4 | `apps/api/test/worktree-carry.test.ts` — dirty + untracked 时快照 apply 后子 worktree 内容一致,父目录不变 | worktree-carry |
| 5 | `apps/frontend/src/__tests__/components/ForkDialog.test.tsx` — 模式切换、提交触发 forkIssue | component |

## Risks

- **依赖正在变化的工作树无法真并行** —— 由 `dependent` 模式兜底:
  延迟到父 settle 再执行,用户自行选择。
- **snapshot apply 冲突** —— 子 worktree 从 main 起步,父改动基于另一
  base 时 `git apply -3` 可能冲突;失败不致命,降级为 warning,子 issue
  仍创建,用户可手动处理。
- **dependent 触发遗漏** —— 父 issue 被删除/取消则子 issue 永久挂起;
  reconciler 增加一条:父 issue isDeleted 时把 forkAwaitingParent 子
  issue 也标记或提示。本期先记日志,UI chip 显示「等待中」。
- **并行负载** —— 多个 issue 同时跑由用户机器承担;dialog 文案提示。
- **createWorktree startPoint 变更** —— 新增可选参数,默认仍 origin/main,
  仅 dependent 路径改传父分支,不影响既有调用。

## Scope

Backend: 1 迁移 + 2 新 service + 1 新端点 + settlement 钩子改动 +
`createWorktree` 参数 + 查询扩展 + 4 测试。
Frontend: 1 新 dialog + 血缘 chip + 3 edits + 1 测试 + i18n。
估约 2 天。

## Alternatives

- **客户端复制 prompt 手动新建** —— 丢血缘、靠人工搬运,否决。
- **共享父 worktree(worktreeOwnerId 列)** —— 接力语义下可行,但与
  并行不兼容且改动面大;`dependent` 模式用「延迟 + 父分支起步」达到
  等价效果而无需共享列。否决。
- **后端 LLM 摘要上下文** —— 留作后续 `includeHistory` 的增强。

## Annotations

- 2026-05-19: 初稿,含 stash carry-over。
- 2026-05-20: 调研发现 BKD worktree 按 issueId 写死且从 main 起步,
  原 carry-over 设计不完整。与用户澄清后确认真实需求是「外挂并行,
  不阻塞主任务」,重写为三模式(independent / snapshot / dependent)
  由用户在 ForkDialog 选择。删除 worktreeOwnerId 共享列方案。
- 2026-05-20: 实现完成。实现差异说明:
  - `git stash create` 不捕获 untracked 文件(`-u` 在 create 上无效),
    snapshot 模式改为「tracked 走 stash + untracked 直接拷贝」
    (`services/worktree-carry.ts` 的 `carryUncommitted`)。
  - 入口落在共享的 `IssueContextMenu`(看板卡片 + issue 详情通用),
    天然桌面/移动双覆盖,未单独做 TopBar 入口与 ⌘⇧F 快捷键。
  - 血缘:顶栏渲染 `↗ from` / `↳ N forks` chip;父 issue 时间线写
    `Forked to #N` system-message。子 issue 的 fork-in system-message
    因 turn-index 与引擎首条消息冲突未写,改由血缘 chip 承担。
  - 后端:迁移 `0023_cultured_trauma.sql`、`services/fork-context.ts`、
    `services/worktree-carry.ts`、`services/fork-dependent.ts`、
    `routes/issues/fork.ts`、settle 钩子、`createWorktree` 幂等 +
    `startPointRef` 参数。测试:`issue-fork.test.ts`(6)、
    `worktree-carry.test.ts`(3)、`ForkDialog.test.tsx`(3) 全绿。
    dependent 模式的 settle 自动接力依赖引擎集成,未写独立 e2e 测试。
