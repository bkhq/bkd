# 20261013-0553-turn-navigator-full-history Show every turn in the chat turn navigator, including unloaded history

- **status**: completed
- **createdAt**: 2026-10-13 05:53
- **approvedAt**: 2026-10-13 06:14
- **relatedTask**: 20261013-0553-turn-navigator-full-history

## Context

- The rail builds turns from the loaded `ChatMessage[]` (`buildTurns`).
- `useIssueStream` loads the latest page over HTTP, keeps live SSE entries
  (capped at 500), and `loadOlderLogs()` prepends one page into `olderLogs`
  using `before=<oldest loaded id>`.
- `getLogsFromDb` paginates by conversation messages (user + assistant),
  `limit` up to 1000, default page `DEFAULT_LOG_PAGE_SIZE = 10`; `cursor` and
  `before` are exclusive ULID bounds and cannot be combined.
- The `/logs/filter/types/user-message` route could list user messages, but
  previews also need the first reply of each turn, and fetching every
  assistant message would ship full reply bodies.

## Proposal

1. **Turn summary endpoint** (backend, shared type, OpenAPI):
   `GET /api/projects/:projectId/issues/:id/turns` ->
   `{ turns: Array<{ messageId, userText, replyText, entriesSince }> }`,
   oldest first. `entriesSince` counts visible log entries from the turn's
   message to the newest one, so the client can estimate how much a jump
   loads.
   One query over visible `user-message` rows (excluding pending ones, as
   the chat does) and the first visible `assistant-message` after each,
   texts cut to 300 chars server-side. Project ownership checked like the
   other issue routes. Uses the existing `(issue_id, visible, entry_type)`
   index.
2. **Client query**: `kanbanApi.getIssueTurns` + `useIssueTurns` in
   `use-kanban.ts`, enabled only while older history exists
   (`hasOlderLogs`); refetched when that flips or the session switches.
3. **Merged turn list** (`SessionMessages`): server turns older than the
   first loaded user message come first, then turns built from loaded
   messages (which also covers turns that arrive live). Unloaded turns carry
   their `messageId` and no list index.
4. **Jump to an unloaded turn**: `useIssueStream` gains
   `loadOlderUntil(messageId)`, which keeps fetching older pages
   (`limit` 200 per request) until the target id is loaded or history runs
   out. The rail calls it, then scrolls once the target row is in the list
   (pending-target effect in `VirtualMessageList`), with auto-follow paused
   as today. The tick shows a loading state while history loads.
   When the estimate (`entriesSince - loaded entries`) exceeds 1000, the
   jump asks for confirmation first, since everything in between is
   loaded.
5. Preview text flattening stays client-side (`toPreviewText`), applied to
   both sources.

Tests (RED first):

- API: turns endpoint returns every turn oldest first with its first reply,
  skips hidden and pending messages, 404s on foreign project.
- `use-issue-stream`: `loadOlderUntil` pages until the target is loaded.
- `SessionMessages`: with older history, the rail lists server turns, and
  clicking one loads history and scrolls to it.

## Risks

- Very long chats: the endpoint returns all turns (hundreds is fine;
  user-message count, not log count). No pagination added.
- Loading far-back history pulls every page in between into `olderLogs`
  (uncapped, as "load more" already does), and `useChatMessages` rebuilds
  the full list on every live event, which can stutter with thousands of
  entries. The confirmation guards accidental far jumps; the rebuild cost is
  tracked in `20261013-0614-incremental-chat-messages`.
- Turn list freshness: older turns never change, and new turns come from
  loaded logs, so the server list does not need live updates.

## Scope

Backend: one route in `routes/issues/logs.ts` (or a new `turns.ts`), a query
helper, shared type, OpenAPI schema, API test. Frontend: `kanban-api.ts`,
`use-kanban.ts`, `use-issue-stream.ts`, `ChatBody.tsx`, `SessionMessages.tsx`,
`TurnNavigator.tsx`, `turn-navigator.ts`, tests. Full tier.

## Alternatives

- **Reuse `/logs/filter/types/user-message`**: no new endpoint, but replies
  for unloaded turns need one extra request per hover.
- **Load only a window around the target** (non-contiguous list): no bulk
  load, but rewrites `useIssueStream`'s pagination model. Rejected for now.
- **Load the whole history up front**: simplest jump, but defeats log
  pagination on long chats.

## Annotations

- Confirmation: asks when `entriesSince - loaded entries > 1000`. In the
  concise chat view the loaded count only includes user/assistant/thinking
  entries while `entriesSince` counts every visible entry, so the estimate
  errs high and asks a little early.
- The unfiltered logs route caps `limit` at 200, which set the
  `loadOlderUntil` page size.
