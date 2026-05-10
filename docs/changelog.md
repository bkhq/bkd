# Changelog

## 2026-05-10 12:55 [BUG-P0]

Close residual chat UI ordering bugs the targeted nine-bug fix
(`05ec320..e1d5273`) didn't reach, and seal the test invariant gaps that
let them slip through.

Root causes addressed:

1. `liveConverter` (long-lived singleton) and `toTimeline` (per-call fresh
   converter) computed different `sequence` values for the same entry. On
   `onDone` `/logs` refetch, ids matched but sequences differed → frontend
   `compareTimeline` re-sorted and the timeline visibly jumped.
2. `nextSequence` used `ts*1000 + subSeq`, which wasn't monotonic when an
   engine emitted a chunk with a backward timestamp (some ACP/Codex flows
   do).
3. Segment ids used a bare numeric suffix (`thinking-10` lex-sorts before
   `thinking-2`), so once `compareTimeline` ties were broken by id the
   long-turn order was wrong.
4. `appendServerMessage` sequence (`Date.now() * 1000`) could be smaller
   than already-rendered system / loading entries; the canonical replacement
   then re-sorted the user message after them.
5. Scope-change effect called `clearLogs()` after the inline render block
   restored cached logs, defeating the LRU cache.
6. `compareTimeline` "legacy first" branch was a fragile escape hatch — a
   single missing `sequence` pinned an entry ahead of every properly-
   sequenced one.
7. `removeEntries` filtered by converter `id` (`turn-N-...`) but
   `emitIssueLogRemoved` ships raw ULIDs; pending recall via
   `DELETE /pending` left rendered entries visible until next refresh.
8. `toTimelineEntry(entry)` legacy single-arg export used a global
   `'__legacy__'` issue bucket; not called anywhere in the tree, but
   shipping it made cross-issue corruption a one-import-away regression.
9. `MarkdownContent` rewrite turned assistant messages from
   Shiki-tokenized raw markdown into rendered HTML; the pre-existing
   Copy button was `opacity-0 group-hover:opacity-100` so users couldn't
   find the only path back to raw markdown.

Fix:

- `nextSequence` rewritten as `max(ts * 1000, lastSeq + 1)` — strictly
  monotonic per issue and identical across live/batch paths.
- Buffer ids zero-padded to 4 digits (`turn-N-thinking-0042`); lex-sort
  matches numerical insertion order for any realistic turn length.
- `toTimeline` no longer pre-sorts entries — DB queries already return in
  ULID/wire order; the defensive sort was producing different
  `nextSequence` traces than the live wire-order ingest.
- Frontend `appendServerMessage` uses
  `max(maxLiveSeq + 1, Date.now() * 1000)` so the optimistic bubble
  always lands at the bottom regardless of in-flight noise.
- Scope-change effect no longer calls `clearLogs()`; render-time inline
  block remains responsible for state reset + cache restore.
- `compareTimeline` simplified to `(sequence, id)`; legacy-first branch
  removed. `toTimelineEntry` synthesizes `sequence` whenever upstream
  forgot to assign it, so the simplified comparator can rely on the
  field always being present.
- `removeEntries` matches by `id` OR `messageId`.
- Legacy `toTimelineEntry(entry)` single-arg export deleted.
- Assistant message Copy button baseline opacity raised to 30, tooltip
  retitled "Copy markdown source" / "复制 Markdown 原文".

Test invariants added (the gap was the bug):

- Backend (`timeline-converter.invariants.test.ts`): equivalence test now
  asserts `sequence` parity across live and batch (previously waived);
  new "out-of-order timestamps still strictly monotonic" and "20-segment
  long turn preserves numerical order" invariants.
- Frontend (`use-issue-stream.invariants.test.tsx`): three new invariants
  covering optimistic-vs-canonical position with intermediate entries,
  LRU cache survival across issue switches, and pending recall by raw
  messageId.
- Frontend (`AssistantCopy.test.tsx`, new file): asserts Copy button
  writes raw markdown source to clipboard and is not opacity-0.

Coverage delta: backend converter 47 → 48 tests; frontend 80 → 86 tests.

Files changed:
- `apps/api/src/engines/timeline-converter.ts`
- `apps/api/src/engines/timeline-converter.test.ts`
- `apps/api/src/engines/timeline-converter.invariants.test.ts`
- `apps/frontend/src/hooks/use-issue-stream.ts`
- `apps/frontend/src/__tests__/hooks/use-issue-stream.invariants.test.tsx`
- `apps/frontend/src/__tests__/components/AssistantCopy.test.tsx` (new)
- `apps/frontend/src/components/issue-detail/LogEntry.tsx`
- `apps/frontend/src/i18n/en.json`
- `apps/frontend/src/i18n/zh.json`

Tracking: CHAT-002 / PLAN-007.

## 2026-05-09 10:35 [BUG-P1]

Fix OpenCode (ACP) hanging indefinitely when quota is exhausted or API calls fail. Added a 10-minute timeout around `connection.prompt()` in `AcpProtocolHandler.runPrompt()`. When timeout fires, the handler now emits `acp-error` and `acp-prompt-result` events so the frontend shows a clear failure message instead of a perpetual "thinking" state. Also attempts to cancel the hung session to free resources.

Files changed:
- `apps/api/src/engines/executors/acp/protocol-handler.ts`
- `apps/api/src/engines/issue/constants.ts`
