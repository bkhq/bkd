# CHAT-005 Pin TimelineEntry sequence on same-id upsert

- **status**: completed
- **priority**: P1
- **owner**: Claude
- **createdAt**: 2026-05-11 11:30
- **startedAt**: 2026-05-11 11:45
- **completedAt**: 2026-05-11 11:50

## Description

User reports intermittent chat-message reordering during long live sessions
("跑着跑着就乱序了, 没法稳定复现"). Screenshot shows a long assistant block
with several tool-uses interleaved; their relative position drifts.

A new reproduction file
`apps/frontend/src/__tests__/hooks/use-issue-stream.reorder-races.test.tsx`
exercises six candidate races identified in the audit. Five are green
(audit's #1 initial-fetch race, #2 load-older race, #3 trim-seam race, plus
out-of-order SSE arrival and `/logs` reconciliation). Three are red:

- `R1a/R1b` — when a streaming `thinking` / `assistant` chunk arrives via
  SSE for an existing entry id and carries a *different* `sequence` than
  the previously rendered chunk for the same id, `appendEntry` /
  `upsertEntry` overwrite the entry in place, taking the new sequence. If
  a `tool-use` was emitted between the two chunks (smaller backend
  sequence), the streaming segment now sorts AFTER the tool-use even
  though it began earlier — the exact reorder the user describes.
- `R6` — when two entries collide on `sequence`, `compareTimeline` falls
  back to lex id (`turn-N-assistant` < `turn-N-thinking`, 'a' < 't'),
  which can invert emission order.

Backend audit confirms `liveConverter` pins `buffer.sequence` at the first
chunk and reuses it (`apps/api/src/engines/timeline-converter.ts:265, 192`),
so the on-the-wire path *should* not deliver same-id different-sequence
chunks. But `log-updated` events (`apps/api/src/events/issue-events.ts:8`)
carry a raw `NormalizedLogEntry` without `sequence`; the frontend
`onLogUpdated` handler runs it through `toTimelineEntry`, which synthesizes
`sequence = ts*1000`. Zero in-source callers today — but the channel is
live and any future caller (or a backend hotfix that retroactively edits
content) will produce the R1 reorder. Reconnect / refresh / multi-tab
flows can also drive a NormalizedLogEntry through `toTimelineEntry`
without a canonical sequence in edge cases not yet enumerated.

Scope: harden the frontend so the backend's "sequence is immutable after
first observation" invariant is enforced at the React state boundary too,
removing the entire class of "same id arrives later with different
sequence" reorders without depending on which upstream path produced it.

## Acceptance Criteria

- [x] `appendEntry` / `upsertEntry` preserve the existing entry's
      `sequence` when the upsert matches by **id** (immutability after
      first observation). Optimistic→canonical replacement (matched by
      `messageId` with differing ids) continues to take the canonical
      backend sequence — the optimistic sequence is a temporary marker.
- [x] `R1a` (thinking surrounded by tool-use) and `R1b` (assistant
      surrounded by tool-use) in `use-issue-stream.reorder-races.test.tsx`
      turn green.
- [x] Existing 86+ frontend tests stay green, including
      `use-issue-stream.invariants.test.tsx` (optimistic-at-bottom,
      post-restart resort, LRU cache survival, pending recall).
- [x] No backend change required; if backend ever needs to update an
      already-emitted entry's sequence, it must go through a new explicit
      channel — document this.
- [x] `R6` (same-sequence id-lex tiebreaker) pinned as `it.fails` and
      documented as out-of-scope (backend `nextSequence` is strictly
      monotonic per converter, so ties only arise on cross-instance
      bugs that should be fixed at source rather than papered over with
      a frontend tiebreaker).

### 2026-05-11 implementation summary

Files modified (1 src + 1 test):

- `apps/frontend/src/hooks/use-issue-stream.ts` — added a `pinSequence`
  helper applied inside `appendEntry` and `upsertEntry`. When the upsert
  matches an existing entry by **id** (and the existing entry already
  has a defined `sequence`), the incoming entry's `sequence` is replaced
  with the existing one before being stored. All other fields (content,
  metadata, timestamp, etc.) use the incoming entry's values. Match by
  `messageId` with differing ids (optimistic→canonical) intentionally
  bypasses the pin so canonical's backend sequence is adopted.
- `apps/frontend/src/__tests__/hooks/use-issue-stream.reorder-races.test.tsx`
  — already in tree before the fix; R6 marked `it.fails` to keep the
  test as an active document of the upstream sequence-tie invariant
  without going red in CI.

Verification:

- `bunx vitest run src/__tests__/hooks/use-issue-stream.reorder-races.test.tsx
  src/__tests__/hooks/use-issue-stream.test.tsx
  src/__tests__/hooks/use-issue-stream.invariants.test.tsx`
  — 25/25 pass (R1a / R1b green; R6 documented).
- `bunx vitest run` (full frontend) — 117/117 pass across 16 files.
- `bunx eslint src/hooks/use-issue-stream.ts
  src/__tests__/hooks/use-issue-stream.reorder-races.test.tsx`
  — zero new violations (3 pre-existing `Array.from` style errors in
  unmodified `use-issue-stream.ts` lines 196/391/469 remain, same as
  noted in CHAT-002 implementation summary).

## ActiveForm

Pinning TimelineEntry sequence on same-id upsert to stop intermittent
chat-message reordering.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Reproduction file already in place:
  `apps/frontend/src/__tests__/hooks/use-issue-stream.reorder-races.test.tsx`.
- Related history: CHAT-002 / PLAN-007 established the backend
  buffer.sequence invariant; this task extends it to the React state
  boundary.
- Related plan: PLAN-010.
