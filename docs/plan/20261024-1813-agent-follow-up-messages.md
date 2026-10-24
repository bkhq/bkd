# 20261024-1813-agent-follow-up-messages Show agent-sent follow-ups apart from user messages

- **status**: completed
- **createdAt**: 2026-10-24 18:13
- **approvedAt**: 2026-10-24 18:30
- **relatedTask**: 20261024-1813-agent-follow-up-messages

## Context

- `POST /issues/:id/follow-up` (`routes/issues/message.ts`) takes `prompt`, `model`,
  `permissionMode`, `busyAction`, `displayPrompt`; nothing says who sent it. It calls
  `dispatchFollowUp()` (`routes/issues/_shared.ts`), which either queues a pending
  message (`metadata.type = pending | done`) or persists a `user-message` log and runs
  the turn.
- Other callers of `dispatchFollowUp()`: `messages/service.ts` (wake signal
  `[message-reply …]` / `[event-decision …]`) and the cron `issue-follow-up` action.
- The `bkd` skill (`~/.agents/skills/bkd`, outside this repo) sends follow-ups with
  `bkd_follow_up` (`references/rest-api.md`); agents already know their own
  `projectId`/`issueId` (the messages contract requires `source`). BKD injects no
  `BKD_*` env into engine processes.
- Queued messages are merged on flush (`db/pending-messages.ts`): prompts joined, scalar
  metadata last-wins, so one merged log can mix senders.
- Frontend: `UserMessageEntry` (`LogEntry.tsx`) renders every `user-message` as the
  right-aligned bubble; queued ones (`type: pending`) stay left.

## Proposal

1. Sender on the wire: optional `sender` on the follow-up body,
   `{ kind: 'agent', projectId, issueId }`; the route checks that the sender issue exists
   (an issue may write to itself). Absent means `user` (chat input, old agents).
2. Engine env: inject `BKD_PROJECT_ID` / `BKD_ISSUE_ID` (and `BKD_URL` when known) into
   every engine spawn, so the skill fills `sender` without the agent having to know its
   ids. Skill change: `bkd_follow_up` adds `sender` from those vars.
3. Storage: `metadata.sender = { kind: 'agent' | 'system', projectId?, issueId?, via? }`
   on the pending row and the persisted `user-message`; internal wakes set
   `{ kind: 'system', via: 'message' | 'cron' }`. No schema migration (metadata is JSON).
   Pending merge: stop merging across different senders (flush user and agent messages
   as separate turns' input in order), or keep `senders[]` per part (see Alternatives).
4. Frontend: a `user-message` with `metadata.sender.kind !== 'user'` renders as a
   left-aligned "agent message" card: header with the sender issue (`#number title`,
   link), muted tone, long content collapsed with expand; system wakes render as a
   compact one-line system row. Still a turn anchor in the turn rail; queued ones keep
   recall/edit.
5. Shared type `FollowUpSender`, OpenAPI schema, i18n (en/zh), tests (API: sender stored
   and validated; UI: agent card vs user bubble).

## Risks

- Needs a skill update to take effect for agent traffic; until then agent follow-ups
  still look like user messages (no regression).
- Splitting merged pending messages by sender can turn one turn into several when an
  agent and the user both queue input during a busy turn.
- The in-memory queue of a live process (`managed.pendingInputs`, a race-only path) still
  merges every input and keeps the last one's metadata.

## Scope

API: `openapi/schemas.ts`, `routes/issues/message.ts`, `_shared.ts`,
`db/pending-messages.ts`, `messages/service.ts`, cron follow-up action, executors' spawn
env. Shared types. Frontend: `LogEntry.tsx`, chat-block tone, i18n. Skill:
`references/rest-api.md` (`bkd_follow_up`).

## Alternatives

- Detect agents by prompt prefix (`[L2 …]`, `[message-reply …]`): no API change, but
  fragile and misses ad-hoc agent messages.
- Keep merging pending messages and store `senders[]` with the part boundaries: one
  turn, but the UI has to split one log into parts.

## Annotations

- 2026-10-24: approved. Keep `user-message` with a `metadata.sender` subtype (no new entry type); pending messages from different senders are not merged (option A); no "reply to sender" button.
