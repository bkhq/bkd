# 20261016-0448-background-task-as-subagent Background Bash tasks render as subagents in the chat

- **status**: completed
- **priority**: P2
- **owner**: claude/markdown-final-reply-only
- **createdAt**: 2026-10-16 04:48

## Description

A Bash call run in the background emits `task_started` / `task_notification` for its own tool call.
The chat rebuilder treats every `task_*` event as subagent lifecycle and attaches a subagent thread to
the Bash call, so `ToolItems` renders the command as an Agent panel (e.g. `k4t6i3ll`, result
`{"fields":{"title":"x"},"peakRssMB":68}`).

Acceptance:

- A non-agent tool call never carries a subagent thread, even with `task_*` events for its id.
- Agent/Task dispatches still nest their subagent activity.

## ActiveForm

Keeping background tasks out of subagent threads

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Plan: [20261016-0448-background-task-as-subagent](../plan/20261016-0448-background-task-as-subagent.md)
