---
id: FORK-001
title: One-click fork current issue into a new spawned issue
status: in_progress
priority: P1
owner: claude
created: 2026-05-19
relatedPlan: PLAN-021
---

# FORK-001 — One-click fork current issue into a new spawned issue

## Goal

让用户在任意 issue 的会话里通过一个按钮 + 弹窗，把后续任务分流到一个
新的子 issue，自动建立 parent/child 血缘并可选自动开跑，避免长任务
占用当前会话上下文。

## Acceptance

- 桌面 + 移动 IssueDetail TopBar overflow 菜单中存在「分流到新 issue」入口。
- 弹窗包含：指令输入、上下文模式（minimal / full-summary）、engine 继承、
  新 worktree 选项、两个提交按钮。
- 成功后跳转到新 issue 详情页；父 issue 时间线出现 `Forked to #N` system-message；
  新 issue 时间线出现 `Forked from #N` system-message。
- 新 issue 的 `parentIssueId` 写入正确；列表/血缘 chip 可点击互相跳转。
- 单元测试覆盖：路由 happy path、autoExecute=false 分支、UI 提交流程。

## Out of scope

- LLM 驱动的对话摘要（留待后续 `mode='ai-summary'`）。
- 跨项目 fork。
- 父 issue cron / webhook 联动。

See [PLAN-021](../plan/PLAN-021.md) for full design.
