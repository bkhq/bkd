---
id: PLAN-021
title: One-click fork current issue into a new spawned issue
status: draft
created: 2026-05-19
relatedTask: FORK-001
---

# PLAN-021 — One-click fork current issue into a new spawned issue

## Context

- 用户在长会话中常常想「分流出去」——把后续任务剥离到新 issue 里执行，
  避免占用当前会话上下文，也方便并行。
- 数据库 `issues.parentIssueId` 字段已经存在
  (`apps/api/src/db/schema.ts:57`)，并有 `issues_parent_issue_id_idx` 索引，
  但目前没有 UI 入口写入；只在 whiteboard 绑定路径偶尔被使用。
- 现有 `POST /api/projects/:projectId/issues` 已经接受可选字段
  (engineType / model / useWorktree / prompt)，扩展空间足够。
- 现有「执行」入口 `POST /issues/:id/execute` 走 IssueEngine，复用即可。

## Proposal

### Backend

1. **接口扩展**：在 `routes/issues/create.ts` 的 Zod schema 中新增可选
   `parentIssueId: z.string().optional()`。如果传入：
   - 校验该 parent 属于同一 projectId（防止跨项目）。
   - 写入 `issues.parentIssueId`。
   - 在新 issue 创建后，立即往**父** issue 的 `issues_logs` 追加一条
     `entryType='system-message'` 的可见 log，内容形如
     `Forked to #<number> <title>`，附带 metadata `{ kind: 'fork-out',
     childIssueId }`，让父会话的 timeline 能看到这次分流。
   - 在新 issue 的 `issues_logs` 追加一条同类型 `system-message`
     `Forked from #<number> <title>`, metadata `{ kind: 'fork-in',
     parentIssueId }`。

2. **派生上下文构造**：新增 `apps/api/src/services/fork-context.ts`：
   - `buildForkPrompt({ parentIssueId, mode, extraInstruction })`
   - 两种 mode：
     - `'minimal'`（默认）：只取父 issue 的标题、最后一条用户消息、
       最近一条 assistant 消息文本，组装成 ~30 行的 prompt。
     - `'full-summary'`：调用 cockpit 已有的 `searchLogs` / 日志聚合
       拉取整段 transcript，截断到 ~8k 字符。先做最朴素的「按 turn
       逆序取直到字符上限」，不做 LLM 摘要（避免新增 token 成本和
       延迟，后续可再加 `'ai-summary'` mode）。
   - 返回 `{ title, prompt, suggestedTag }`。
   - 默认 `title = "↳ " + parent.title` 截断到 80 字。

3. **新端点**（薄包装，便于前端原子调用）：
   `POST /api/projects/:projectId/issues/:id/fork`，body:
   ```ts
   {
     instruction: string,            // 新任务的指令（必填）
     mode?: 'minimal' | 'full-summary',
     inheritEngine?: boolean,        // default true
     inheritWorktree?: boolean,      // default false（worktree 复用语义复杂，先默认新开）
     carryUncommitted?: boolean,     // default true (auto: 仅当父 worktree dirty 且父 idle)
     autoExecute?: boolean,          // default true
   }
   ```
   该 handler：构造 prompt → 调用现有 createIssue 内部函数（避免 HTTP 跳转）
   → 写父/子 system-message → 若 `autoExecute` 触发 `IssueEngine.executeIssue`
   → 返回 `{ issue, parentIssueId }`。

4. **未提交改动 carry-over**（核心安全保障）：
   - 新增 `apps/api/src/services/worktree-carry.ts`：
     - `snapshotDirty(parentWorktreePath)` — 在父 worktree 运行
       `git stash create -u`（含 untracked，不修改 working tree），
       返回 stash sha；若仓库 clean 返回 null。
     - `applySnapshot(childWorktreePath, sha)` — 在子 worktree 跑
       `git stash apply <sha>`；失败则回退为
       `git diff <sha>^..<sha>` → `git apply -3` 走三方合并。
     - stash 对象不会被 gc 回收太快（reflog 保留 90 天），无需主动清理。
   - fork handler 顺序：snapshot → 创建子 issue + worktree → apply →
     如果 apply 失败，保留子 issue 但响应里附 `carryError`，前端 toast
     提示「未提交改动未能带过去，原 worktree 仍保留」。
   - 父 worktree **完全不动**，原会话改动不会丢；用户随时可回去 commit。
   - 仅在 `parent.sessionStatus !== 'running' && !== 'pending'` 时允许
     `carryUncommitted=true`；否则后端拒绝并提示。

5. **查询扩展**：`GET /api/projects/:projectId/issues/:id` 响应里附带
   `parentIssueId`（如果已经返回则跳过）+ `children: { id, title, statusId }[]`
   方便 UI 显示血缘。新增轻量 `GET /api/projects/:projectId/issues/:id/lineage`
   返回 `{ parent?, children[] }` 也可，二选一，倾向前者减少端点数量。

### Frontend

1. **顶栏入口** `apps/frontend/src/components/issue-detail/`：
   - 在现有 TopBar overflow 菜单里新增「分流到新 issue」(`chat.fork.cta`)
     （桌面 + 移动同一菜单），快捷键 `⌘⇧F`。
   - 弹出 `ForkDialog`：
     - 必填多行输入「新任务指令」。
     - 上下文模式 radio：`最近一轮（轻）` / `完整对话摘要（重）`。
     - 复选：`继承 engine/model`（默认勾选）、`新开 worktree`
       （默认勾选，含 tip：避免与当前 issue 抢工作目录）。
     - 「创建并执行」/「仅创建」两个按钮。

2. **API client + hook**：
   - `kanban-api.ts` 新增 `forkIssue(projectId, issueId, payload)`。
   - `use-kanban.ts` 新增 `useForkIssue()`；成功后：
     - `invalidateQueries(queryKeys.issues(projectId))`
     - 跳转 `/projects/:projectId/issues/:newIssueId`（react-router `navigate`）。
     - toast 提示 `chat.fork.toastCreated`，文字带「打开父 issue」反向链接。

3. **血缘 UI**：
   - 在 IssueDetail 顶栏标题旁，如果存在 `parentIssueId`：渲染一个
     `↗ from #N` chip，点击跳父 issue。
   - 如果存在 children：渲染 `↳ N forks` chip，hover/点击展开列表。
   - 复用现有 chip-surface 设计 token。

4. **i18n**：`chat.fork.*` 新增以下键（en + zh）：
   `cta`, `dialog.title`, `dialog.instruction`, `dialog.modeMinimal`,
   `dialog.modeFull`, `dialog.inheritEngine`, `dialog.newWorktree`,
   `submit`, `submitAndRun`, `toastCreated`, `lineage.from`, `lineage.forks`.

### Tests

| # | Test | Implementation |
|---|------|----------------|
| 1 | `apps/api/test/issue-fork.test.ts` — POST /fork 创建子 issue，parentIssueId 正确，父/子双向写入 system-message | route + service |
| 2 | 同上文件中：mode='full-summary' 截断到字符上限；autoExecute=false 不触发 IssueEngine | service |
| 3 | `apps/api/test/worktree-carry.test.ts` — 父仓库 dirty + untracked 时 carry-over 后子 worktree 内容一致；父 worktree 不变 | service |
| 4 | `apps/frontend/src/__tests__/components/ForkDialog.test.tsx` — 提交触发 forkIssue + 跳转；dirty 态显示 carry-over 行 | component |

## Risks

- **prompt 上下文质量** — minimal 模式可能丢失关键背景，导致子 agent
  追问；缓解：dialog 中显示「将携带的上下文预览」，可让用户编辑追加。
- **worktree 冲突** — 子 issue 若复用父 worktree 会导致两个 agent
  同时改同一文件树。默认行为强制「新开 worktree」，UI 文案提示。
- **未提交改动丢失** — 新 worktree 默认从 HEAD 出发，父 worktree 里
  uncommitted/untracked 文件不会自动出现在子 worktree。通过
  `git stash create -u` 做只读快照 + 子 worktree 内 `git stash apply`
  解决；父 worktree 状态零修改，最坏情况是子 worktree apply 失败但
  父侧改动完好。父 agent 正在跑时禁止 carry-over，避免读到半成品。
- **循环 fork** — 限制单层即可（一个 issue 既可以是 parent 也可以是 child），
  无需禁止链式 fork；DB 层不做 cycle 检查。
- **autoExecute 失败** — 如果 executeIssue 抛错，子 issue 已经存在；
  返回响应里附 `executeError?: string`，前端 toast 显示「已创建但启动失败，
  可手动 Run」。
- **多 agent 并行**：父 issue 还在 working 状态时 fork 会再启动一个进程；
  ProcessManager 按 issueId 分组，互不影响，但用户机器并发负载需自知。
  在 dialog 里加一行小提示。

## Scope

Backend: 1 schema 扩展 + 1 service 新文件 + 1 新端点 + 1 查询字段扩展 + 2 测试。
Frontend: 1 新 dialog + 1 chip blob + 3 edits + 1 测试 + i18n。
估约 1–1.5 天。

## Alternatives

- **「复制 issue」纯 client 端**：让用户从父 issue 复制 prompt 粘贴新建；
  成本低但每次都靠用户搬运、丢失血缘。否决，体验不够「一键」。
- **同 issue 内开新 turn 而不分流**：和需求相反，依旧占用当前会话。
- **后端 LLM 摘要 mode**：留作后续 `mode='ai-summary'` 扩展，本次不做，
  避免引入新的 token 计费路径。
