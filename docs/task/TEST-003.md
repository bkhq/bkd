# TEST-003 深度测试进程与状态编排并补充架构文档

- status: completed
- priority: P1
- owner: codex
- createdAt: 2026-03-04 20:26 UTC
- updatedAt: 2026-03-04 20:42 UTC

## Summary
在已有回归测试基础上，继续对 IssueEngine 编排层执行深度测试，重点覆盖锁队列、锁超时、并发探测去重等高风险时序场景；同时把进程与状态管理架构补充到统一架构文档，形成可维护的测试与设计基线。

## Scope
- 新增/补强 `apps/api/test` 中与 `withIssueLock`、`startup-probe`、进程状态流有关的测试。
- 运行后端与全仓测试验证稳定性。
- 更新 `docs/architecture.md` 增补“进程与状态编排架构 + 测试矩阵”说明。

## Acceptance Criteria
- 至少新增一组锁相关深度测试（队列上限、超时释放或互斥）。
- 至少新增一组并发探测相关测试（避免重复 live probe）。
- `bun run test:api` 与 `bun run test` 均通过。
- 架构文档包含组件职责、关键时序、失败回滚与测试覆盖映射。

## Notes
- 该任务跨测试与文档，优先保证测试稳定性并避免 flaky。
- 根据深测结果已追加一轮最小修复：`turn-completion` pending flush 失败可重试、锁超时深度清理、顺序敏感用例去 flaky。
