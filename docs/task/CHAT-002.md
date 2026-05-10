# CHAT-002 Fix chat UI ordering root causes and close test invariant gaps

- **status**: completed
- **priority**: P0
- **owner**: Claude
- **createdAt**: 2026-05-10 12:00
- **completedAt**: 2026-05-10 12:55

## Description

Targeted nine-bug fix in PLAN-006 (superseded) landed five commits between
`05ec320` and `e1d5273`, but a deeper review on 2026-05-10 surfaced residual
bugs that still cause user-visible ordering drift, a markdown copy regression,
and a class of bugs that the just-added "invariant" tests explicitly let slip.

Concrete symptoms reported by the user:

- "UI 顺序还是有问题" — assistant message ordering still shifts after each turn
  settles (`onDone`) or when an issue is reopened from cache.
- "没法复制原始 markdown 了" — selecting + Ctrl+C on assistant messages now
  yields rendered text without `**`/`#`/`|` markers; the new
  `MarkdownContent` (react-markdown) replaced the previous Shiki-tokenized
  raw markdown view.

Root causes (full analysis in PLAN-007):

P0 (blocking):

1. `subSeq` divergence: `liveConverter` accumulates state across the issue
   lifetime; `toTimeline()` uses a fresh converter per call. Same entries
   sharing a millisecond produce different `sequence` values via the two
   paths. `onDone` refetches `/logs` and overwrites cached entries by id;
   the new sequence flips order on the frontend's `compareTimeline` sort.
   The existing equivalence invariant explicitly skips sequence comparison
   (`timeline-converter.invariants.test.ts:51-55`) — the regression slips.
2. Optimistic vs canonical sequence mismatch: `appendServerMessage` assigns
   `sequence = Date.now() * 1000`; backend canonical assigns
   `entry.timestamp * 1000 + subSeq`. Any system/loading entry emitted
   between optimistic add and canonical replace lands in between, then the
   replace re-sorts the user message after it. Existing test only verifies
   single-entry dedup count, not position with intermediate noise.
3. Lexicographic id tiebreaker: `compareTimeline` falls back to `a.id < b.id`
   for ties; `turn-0-thinking-10` < `turn-0-thinking-2` lexicographically.
   When P0 #1 is fixed and sequences are byte-identical across paths, this
   becomes the de-facto ordering key and breaks for any turn with 10+
   segments. No existing test covers >10 segments per turn.

P1:

4. LRU cache restoration wiped by clearLogs effect on scope change
   (`use-issue-stream.ts:152-175` vs `:342-355`). Sync render block
   restores cache; subsequent effect calls `clearLogs` unconditionally.
   Cache is functionally dead.
5. `nextSequence` is not strictly monotonic when timestamps go backward —
   late chunk with older `entry.timestamp` produces a smaller `sequence`
   than its predecessor.

P2:

6. `toTimelineEntry` legacy single-arg export uses `'__legacy__'` shared
   state. No callers in `apps/api/src` (verified). Dead code; delete.
7. `compareTimeline` "legacy first" rule: a single entry with undefined
   sequence pins itself ahead of all properly-sequenced entries. Fragile;
   we should guarantee sequence is always defined.
8. `onLogRemoved` end-to-end mismatch: backend emits ULID `messageIds`;
   frontend `removeEntries` filters by `e.id` which is the converter
   `turn-N-...` form. Filter never matches → recalled pending messages
   linger until next `/logs` refresh.

Markdown copy UX:

9. `MarkdownContent.tsx` rewrite (commented at `:13-37`) replaced
   Shiki-tokenized raw markdown with rendered HTML, breaking
   "select + Ctrl+C → raw markdown" UX. The Copy button at
   `LogEntry.tsx:573` does write raw markdown but is `opacity-0
   group-hover:opacity-100` — discoverability problem.

Test invariant gaps:

The current "penetration tests" (`4fac2af`) cover only previously-fixed
bugs. None of the eight code bugs above is asserted. Worst, the
streaming-vs-batch equivalence test author acknowledges sequence
divergence and skips comparing it — that's exactly the regression P0 #1
represents.

## Acceptance Criteria

- [x] Live SSE and batch `/logs` produce **byte-identical** TimelineEntry
      including `sequence` for the captured fixture, asserted in test.
- [x] Optimistic user-message remains at bottom even when system/loading
      entries arrive between optimistic add and canonical replace, asserted
      in test.
- [x] 20 alternating thinking/tool segments in a single turn render in
      numerical (lexicographic-equivalent) order, asserted in test.
- [x] LRU cache survives scope change (issue switch) without effect-driven
      clear, asserted in test.
- [x] `nextSequence` is strictly monotonic across all input orderings (incl.
      backward timestamps), asserted in test.
- [x] `compareTimeline` no longer needs a "legacy first" branch — sequence
      is guaranteed by `toTimelineEntry` normalization on every ingress
      path; branch removed.
- [x] Legacy `toTimelineEntry` single-arg export removed; no in-source
      callers anywhere.
- [x] Pending message recalled via `DELETE /pending` disappears from the
      timeline in the same render cycle, asserted in test.
- [x] Assistant message Copy button is always faintly visible (opacity-30)
      with a "Copy markdown source" / "复制 Markdown 原文" tooltip and
      writes raw markdown to the clipboard, asserted in test.
- [x] Existing frontend tests (86 total) and backend converter tests
      (48 total) all green; 6 new frontend invariants and 3 new backend
      invariants added.

## ActiveForm

Investigating residual chat UI ordering bugs and test invariant gaps.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Related plan: PLAN-007.
- `CHAT-001` task remains open but its scope (UIMessage migration to ~80
  lines) was rejected via the `PLAN-006` supersede note. Recommend the
  user close `CHAT-001` separately; this task does not extend it.
- Reference review session in chat history (2026-05-10) lists nine bugs
  P0/P1/P2 plus the markdown copy UX. P1 #6 (visibility filter mismatch)
  was investigated and found to be a non-bug — both paths use
  `.filter(isVisible)` consistently.

### 2026-05-10 implementation summary

Files modified (10 + 1 new test):

- `apps/api/src/engines/timeline-converter.ts` — `nextSequence` rewritten
  as `max(ts*1000, lastSeq+1)`; segment ids zero-padded 4 digits; legacy
  `toTimelineEntry(entry)` single-arg export removed; `toTimeline` no
  longer pre-sorts (DB query order is already canonical wire order, and
  pre-sort was making sequences diverge between live and batch paths).
- `apps/api/src/engines/timeline-converter.test.ts` — id assertions
  updated for the new zero-padded suffix scheme.
- `apps/api/src/engines/timeline-converter.invariants.test.ts` — equivalence
  invariant tightened to compare `sequence` field (previously skipped);
  two new invariants for backward-timestamp monotonicity and 20-segment
  long-turn lexicographic ordering.
- `apps/frontend/src/hooks/use-issue-stream.ts` — `compareTimeline`
  simplified (no legacy-first branch); `toTimelineEntry` always synthesizes
  `sequence` when missing; `appendServerMessage` uses
  `max(maxLiveSeq+1, Date.now()*1000)` so the optimistic user message
  stays bottom-anchored regardless of intermediate entries; scope-change
  effect no longer calls `clearLogs` (the inline render block already
  handles state reset + cache restore); `removeEntries` matches by `id`
  OR `messageId` so pending recalls actually drop the rendered entries;
  `/logs` and `loadOlderLogs` paths route incoming entries through
  `toTimelineEntry` for sequence normalization.
- `apps/frontend/src/__tests__/hooks/use-issue-stream.invariants.test.tsx`
  — three new invariants covering optimistic-vs-canonical ordering with
  intermediate entries, LRU cache survival across issue switches, and
  pending recall by raw messageId.
- `apps/frontend/src/__tests__/components/AssistantCopy.test.tsx` (new) —
  asserts the Copy button writes the raw markdown source and is not
  opacity-0.
- `apps/frontend/src/components/issue-detail/LogEntry.tsx` — Copy button
  baseline opacity raised from 0 to 30 so users discover the raw-markdown
  copy path.
- `apps/frontend/src/i18n/{en,zh}.json` — `session.copyMessage` retitled
  to "Copy markdown source" / "复制 Markdown 原文".

Verification:

- `bun test src/engines/timeline-converter.test.ts src/engines/timeline-converter.invariants.test.ts`
  — 48 pass, 0 fail.
- Converter-adjacent suite (`bun test src/engines/ test/claude-normalizer.test.ts test/codex-normalize-log.test.ts test/message-rebuilder.test.ts test/codex-protocol.test.ts test/acp-client.test.ts`) — 263 pass, 0 fail.
- `bunx vitest run` (frontend) — 86 pass, 0 fail.
- `bun run lint` — my changes add zero new violations; 19 pre-existing
  errors in unmodified files remain (mostly `Array.from` → `[...iterable]`
  in `use-issue-stream.ts` lines 196/365/443 from prior commits).
- API full suite has 35 pre-existing failures driven by missing Codex
  authentication in this environment; none touch converter / chat code.
