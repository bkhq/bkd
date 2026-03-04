# PLAN-009 深度测试进程与状态编排并产出架构文档

- status: completed
- task: TEST-003
- owner: codex
- createdAt: 2026-03-04 20:26 UTC
- updatedAt: 2026-03-04 20:42 UTC

## Context
- 现有回归已覆盖 execute/restart 失败回滚、删除终止失败、pending 消息恢复等关键失败分支。
- 仍缺少编排层更底层的并发与锁语义测试：`withIssueLock` 的队列上限、锁超时释放、顺序互斥等。
- `startup-probe` 新修复了 in-flight dedup 逻辑，需要并发用例防止回归。
- 架构文档已有总体信息，但缺少“进程/状态编排时序 + 测试覆盖映射”。

## Proposal
- 新增 `apps/api/test/issue-lock.test.ts`：覆盖锁互斥、队列深度上限、超时失败后恢复。
- 新增/补强 `apps/api/test/startup-probe.test.ts`：mock live probe，验证并发调用仅触发一次底层 probe。
- 复跑 `bun run test:api` 与 `bun run test`，确保无 flaky。
- 更新 `docs/architecture.md`：补充状态机、关键失败回滚点、测试矩阵与剩余风险。

## Risks
- 锁超时测试容易受时间抖动影响，需使用可控超时和充足 margin。
- probe 并发测试需要 mock 缓存/DB路径，避免真实环境噪声。

## Scope
- 新增/修改后端测试文件（`apps/api/test/*`）。
- 更新统一架构文档（`docs/architecture.md`）。

## Alternatives
- 方案 A（采用）：单元级深测 + 少量集成回归，稳定且反馈快。
- 方案 B：引入更重 e2e 并发测试，覆盖更全但维护成本高。
