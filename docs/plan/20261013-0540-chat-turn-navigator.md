# 20261013-0540-chat-turn-navigator Add a turn navigator rail with hover previews to the chat area

- **status**: completed
- **createdAt**: 2026-10-13 05:40
- **approvedAt**: 2026-10-13 05:41
- **relatedTask**: 20261013-0540-chat-turn-navigator

## Context

- `components/issue-detail/ChatBody.tsx`: the message area is a `relative`
  wrapper around the scroll container (`scrollRef`); the scroll-to-top/bottom
  buttons sit in it as `absolute right-3 bottom-3`, so they do not scroll with
  the content.
- `components/issue-detail/SessionMessages.tsx`: `LegacySessionMessages` turns
  logs into `ChatMessage[]` (`useChatMessages`), owns the auto-follow state
  (`nearBottomRef`: follow the bottom while the user is near it), and renders
  `VirtualMessageList`. From `VIRTUALIZE_THRESHOLD = 80` messages the list is
  virtualized with `@tanstack/react-virtual` (`anchorTo: 'end'`), so an
  off-screen message has no DOM node; every row carries `data-index`.
- `hooks/use-chat-messages.ts`: a turn starts at a `type: 'user'` message
  (`entry.content`); the reply text is the following `type: 'assistant'`
  message. Pending user messages are returned separately and are not turns
  yet.
- Logs are paginated (live window capped at 500 plus "load more"), so only
  loaded turns are known on the client.
- `components/ui` has `popover.tsx` but no tooltip; a hover preview needs no
  click-to-open behaviour.
- Tests: `src/__tests__/components/session-messages.test.tsx`,
  `src/__tests__/hooks/use-chat-messages.test.ts`.

## Proposal

1. **Turn extraction** (`components/issue-detail/turn-navigator.ts`, pure):
   `buildTurns(messages)` returns `{ index, userText, replyText }` for each
   user message, where `index` is its position in `messages` and `replyText`
   is the first assistant text before the next user message. Text is
   flattened to one line of plain text (Markdown markers and whitespace
   collapsed) and length-capped.
2. **Rail component** (`components/issue-detail/TurnNavigator.tsx`):
   - absolutely positioned at the right-middle of the message area,
     `max-h` of about 60% of its height, `overflow-y-auto` with a hidden
     scrollbar when ticks do not fit;
   - one button per turn: a short muted tick, the active turn longer and in
     the foreground colour; `aria-label` from i18n with the turn number;
   - hover/focus shows a preview card left of the rail (user text bold,
     clamped to 3 lines; reply muted, clamped to 2 lines), styled like the
     existing floating buttons (`border bg-background/95 shadow`);
   - hidden below the `md` breakpoint and with fewer than 2 turns.
3. **Wiring** (`SessionMessages.tsx`):
   - `VirtualMessageList` exposes `scrollToIndex(index)` and the visible
     range via a ref: virtualized mode uses `virtualizer.scrollToIndex(index,
     { align: 'start', behavior: 'smooth' })` and `getVirtualItems()`; plain
     mode uses the `data-index` row's `scrollIntoView` and the row offsets.
   - Jumping sets `nearBottomRef.current = false` first, so auto-follow stops.
   - The active turn is the last turn whose row starts at or above the top
     of the viewport, recomputed on scroll in a `requestAnimationFrame`.
   - The rail is rendered through a portal into a slot in `ChatBody`'s
     `relative` wrapper (or the wrapper is passed down as a ref), so it stays
     fixed while the list scrolls.
4. **Layout**: in `fullWidthChat` mode the message column gets right padding
   equal to the rail width so ticks do not cover text.
5. **i18n**: `session.turnNavigator` (rail label) and
   `session.jumpToTurn` ("Jump to turn {{n}}") in `en.json` / `zh.json`.

Tests (RED first):

- `buildTurns`: one turn per user message, reply paired with the first
  assistant text, Markdown flattened, no reply when none follows.
- `TurnNavigator`: hidden with < 2 turns; renders one tick per turn; hover
  shows the preview; click calls `onJump(index)`.
- `SessionMessages`: clicking a tick scrolls the target row into view and
  stops auto-follow (plain mode; virtualized mode asserts `scrollToIndex`).

## Risks

- Smooth scrolling to an unmeasured virtual row lands on the estimate
  (`estimateSize: 60`) and settles as rows measure; a second correction pass
  after the scroll ends may be needed.
- Active-turn tracking runs on every scroll frame; it reads cached virtual
  items / offsets only, not layout per row.
- Turns before the loaded window are not listed until "load more".

## Scope

New `turn-navigator.ts`, `TurnNavigator.tsx`; edits to `SessionMessages.tsx`,
`ChatBody.tsx`, `en.json`, `zh.json`; new tests. Frontend only, no API or
dependency change.

## Alternatives

- **List all turns from the server** (`/logs/filter/types/user-message`):
  complete rail, but a jump to an unloaded turn must first page logs in;
  deferred.
- **Show only a window of ticks around the active turn** instead of a
  scrollable rail: fixed height, but the rail no longer reflects the
  conversation's overall shape.
- **Use the existing Popover for previews**: click-to-open semantics and
  focus handling do not fit a hover preview.

## Annotations

- Implementation: jump and active-turn tracking both use the virtualizer
  (rows are measured in plain mode too), so no per-mode code path or extra
  scroll listener; the rail is portaled into ChatBody's message wrapper.
  `scrollToIndex` in virtual-core 3.19 reconciles smooth scrolls against
  late measurements, which covers the first risk.
- The active turn is the last one starting at the top of the viewport. An
  "at the end, highlight the last turn" rule was dropped: in a short chat it
  overrode the turn just jumped to.
