---
id: UPGRADE-001
title: Graceful drain before upgrade restart
status: completed
priority: P1
owner: claude
created: 2026-05-20
relatedPlan: null
---

# UPGRADE-001 — Graceful drain before upgrade restart

## Goal

升级重启时不再粗暴 kill 正在跑的引擎子进程，而是先进入排水（drain）
窗口：拒收新执行、等待在跑的 turn 自然结束，再释放端口、重启。让
"升级"对正在进行的 AI 会话从"中断"变成"等当前 turn 写完后无感重启"。

## Approach

子进程（claude-code / codex CLI）的 stdin/stdout pipe 绑定在 BKD 进程上，
无法跨进程接管，所以不保留子进程。改为在 turn 边界切换：等 in-flight
turn 落库结束后再退出，新进程启动后引擎按 `externalSessionId` 自然
resume。属于此前讨论的"方案 D"，不拆 ProcessManager（方案 C 暂不做）。

## Changes

- `apps/api/src/upgrade/drain.ts`（新增）— `isDraining()` / `setDraining()`
  标志 + `drainRunningIssues()`：轮询 `issueEngine.getActiveProcesses()`
  直到清空或超时（`DRAIN_TIMEOUT_MS` = 5 分钟）。
- `routes/issues/_shared.ts` — `ensureWorking()` 在 `isDraining()` 时拒绝
  （覆盖 execute / follow-up / restart 三条入口）。
- `index.ts` — `registerShutdownForUpgrade` 回调：先停 cron / 周期检查，
  再 `drainRunningIssues()`，最后才 `cancelAll()` + 停服。
- `upgrade/apply.ts` — `APPLY_TIMEOUT_MS` 提升到 `DRAIN_TIMEOUT_MS + 60s`，
  避免安全计时器在排水期间误重置 `isApplying`。
- `packages/shared` — 新增 `UPGRADE_DRAINING_CODE` 机器可读错误码，
  `ensureWorking` 排水拒绝时返回它（不再返回英文散文）。
- 前端 `lib/api-error.ts`（新增）— `apiErrorMessage()` 把已知错误码映射成
  本地化文案；`ChatInput` 的 send / clear-session 错误处理改用它。
- i18n — `session.upgradeDraining` 中英文案。

## Acceptance

- 升级期间 execute / follow-up / restart 返回明确错误，不会新起 turn。
- 在跑的 turn 能跑完并正常 settle 到 `review`，不被 kill。
- 超过 5 分钟未结束的 turn 落回原有 `cancelAll` 路径，reconciler 启动后
  标 `failed`（行为不回退）。
- 单测覆盖 drain 标志、空闲即时排水、`ensureWorking` 排水拒绝、
  前端 `apiErrorMessage` 错误码映射。
- 升级期间前端发送会显示本地化的"服务正在升级重启"提示。

## Out of scope

- 中断 turn 的自动续跑（需要原始 prompt，上下文截断风险高，暂不做）。
- 前端全局"服务已升级"提示 toast（仅在用户主动发送时内联提示）。
- 引擎托管 sidecar 拆分（方案 C）。
- acp / gemini 等不支持 resume 的引擎不在改善范围内。
