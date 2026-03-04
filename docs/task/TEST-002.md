# TEST-002 补充 IssueEngine 集成测试

- status: completed
- priority: P1
- owner: codex
- createdAt: 2026-03-05T12:00:00Z
- updatedAt: 2026-03-04 20:14 UTC

## 描述

围绕后端“进程与 Issue 状态管理”高风险路径，补充回归测试，确保失败回滚、删除终止进程、pending 消息恢复、删除级联行为均有自动化保护。

## 本轮完成项

### 进程/状态回滚回归
- [x] execute spawn 失败后 `sessionStatus` 回滚到 `failed`
- [x] restart spawn 失败后 `sessionStatus` 保持 `failed`
- [x] auto-execute 越界失败时 `sessionStatus` 落到 `failed`

### 删除路径回归
- [x] issue 删除时 terminate 失败返回 500，且不误删
- [x] project 删除时 terminate 失败返回 500，且不误删
- [x] issue 删除成功路径会调用 terminate 并完成软删除
- [x] project 删除成功路径会 terminate 活跃 issue 并完成软删除

### Pending 消息回归
- [x] 多条 pending 消息累积断言改为顺序无关
- [x] flush follow-up 失败时 pending 消息保留可重试

### CRUD 回归补全
- [x] 新增 `DELETE /api/projects/:id` 集成测试（删除后读/list 不可见）
- [x] 新增 `DELETE /api/projects/:projectId/issues/:id` 集成测试（父子 issue 级联不可见）

## 变更文件

- `apps/api/test/helpers.ts`
- `apps/api/test/api-process-state-regression.test.ts`
- `apps/api/test/api-projects.test.ts`
- `apps/api/test/api-issues.test.ts`
- `apps/api/test/api-pending-messages.test.ts`
- `apps/api/test/worktree.test.ts`

## 验收标准

- [x] 新增回归测试均可稳定通过
- [x] `bun run test:api` 全量通过
- [x] `bun run test` 全仓通过
