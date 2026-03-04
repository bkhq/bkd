# PLAN-008 完善进程与状态管理回归测试

- status: implementing
- status: completed
- task: TEST-002
- owner: codex
- createdAt: 2026-03-04 19:54 UTC
- updatedAt: 2026-03-04 20:14 UTC

## Context
- 用户要求先安装依赖并检查测试充分性，然后“详细完善 test”。
- 当前修复涉及 4 个关键风险点：pending 消息不丢失、execute/restart spawn 失败回滚、删除路径强终止进程、auto-execute 越界失败落库。
- 现有测试覆盖成功路径较多，但失败路径和删除终止语义覆盖不足。

## Proposal
- 先执行 `bun install` 解决依赖缺失，再运行 `bun run test:api` 获取基线。
- 在现有 API 集成测试文件中补充针对上述 4 个风险点的回归用例，优先验证失败分支。
- 复跑后端测试，确保新增测试稳定通过。

## Risks
- 依赖真实引擎行为的测试可能受环境差异影响，需要采用可控失败触发条件（如非法 engineType/非法路径）。
- 部分删除路径涉及并发进程，若无稳定触发条件可能导致 flaky。

## Scope
- 新增/修改 `apps/api/test/*` 中与 issue/process 状态流相关测试。
- 不改动前端测试与生产逻辑（除测试必要的最小调整）。

## Alternatives
- 方案 A（采用）：在现有 API 集成测试上增量补充，回归成本低。
- 方案 B：新增独立 e2e 测试套件，覆盖更全但实现成本和维护成本更高。
