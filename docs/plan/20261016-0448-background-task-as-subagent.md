# 20261016-0448-background-task-as-subagent Background Bash tasks render as subagents in the chat

- **status**: completed
- **task**: [20261016-0448-background-task-as-subagent](../task/20261016-0448-background-task-as-subagent.md)
- **createdAt**: 2026-10-16 04:48

## Findings

- The CLI emits `task_started` / `task_notification` for background Bash and Monitor tasks too; they
  carry the Bash `tool_use_id` and no `subagent_type`.
- `partitionSubagents()` (`apps/frontend/src/hooks/use-chat-messages.ts`) builds a thread for every
  `toolCallId` seen in those events; `buildToolGroup()` attaches it to any tool call with that id.
- `ToolItems` routes any item with `subagent` to `AgentToolItem`, so the Bash call shows as an Agent.

## Proposal

- `buildToolGroup()` attaches a thread only to agent dispatches (`Agent` / `Task`).
- Test in `use-chat-messages.test.ts`: a background Bash call with `task_*` events has no thread.
