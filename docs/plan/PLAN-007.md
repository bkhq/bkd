# PLAN-007 审计后端进程与 Issue 状态管理

- status: completed
- task: ENG-015
- owner: codex
- createdAt: 2026-03-04 19:35 UTC
- updatedAt: 2026-03-04 19:45 UTC

## Context
- 后端 Issue 状态管理分散在 DB 字段（`issues.status_id`、`issues.session_status`）、路由校验（`STATUS_IDS` + Zod）、自动流转（`ensureWorking`、`autoMoveToReview`、`reconciler`）与 SSE 事件中。
- 进程状态管理依赖 `ProcessManager` + `IssueEngine` 的内存状态机（`spawning/running/completed/failed/cancelled`），并通过 `/api/projects/:projectId/processes` 暴露。
- `routes/issues/update.ts`、`routes/issues/message.ts`、`routes/issues/command.ts` 对状态迁移有大量分支逻辑（如 working 触发执行、done 触发 cancel、sessionStatus 触发 follow-up/restart）。
- 当前仓库已有 ENG-014 对“进程状态与 issue 状态解耦”做过重构，本次任务聚焦在“审计现状正确性”，不做架构删除。

## Proposal
- 以“审计 + 分级结论”为目标，不改动业务行为。
- 按调用链检查：路由层 → 编排/生命周期 → DB 会话字段写入 → reconciler 补偿路径 → 前端消费契约。
- 输出高风险问题优先，给出最小修复方案和建议验证点。

## Risks
- 审计结论主要基于静态代码路径，未执行真实引擎进程时仍可能遗漏时序问题。
- 一些问题属于“低概率高影响”竞态，需配合集成测试/故障注入才能完全复现。

## Scope
- 包含：`apps/api/src/routes/issues/*`、`apps/api/src/routes/processes.ts`、`apps/api/src/engines/**`、`apps/api/src/db/pending-messages.ts` 的状态相关审计。
- 包含：前端消费点抽查（`hooks/use-kanban.ts`、`components/processes/ProcessList.tsx`）。
- 不包含：本轮不提交功能性修复代码（除非用户追加“开始修复”）。

## Alternatives
- 方案 A（推荐）：先审计后分批修复，降低一次性改动风险。
- 方案 B：直接进入重构修复，效率高但更容易引入回归。
