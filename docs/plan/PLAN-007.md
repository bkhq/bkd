# PLAN-007 Chat UI ordering root causes + invariant test coverage + markdown copy UX

- **status**: completed
- **createdAt**: 2026-05-10 12:00
- **approvedAt**: 2026-05-10 12:30
- **completedAt**: 2026-05-10 12:55
- **relatedTask**: CHAT-002

## Context

### Recent history

Five commits between `05ec320` (refactor: unify timeline converter +
memo render path) and `e1d5273` (test: heap-bound regression guards)
landed a "targeted nine-bug fix" derived from `PLAN-006` (superseded).
The fix introduced:

- A stateful per-issue `TimelineConverter` (`apps/api/src/engines/timeline-converter.ts`)
  shared by SSE (`liveConverter` singleton) and HTTP `/logs` (fresh instance via
  `toTimeline()`).
- A pipeline stage at order 90
  (`apps/api/src/engines/issue/pipeline/timeline-emit.ts`) that runs the
  converter exactly once per emit, then re-emits as `'timeline-entry'`.
- A `sequence` field on `TimelineEntry` computed as
  `entry.timestamp_ms * 1000 + subSeq` (timestamp-based + per-ms tiebreaker).
- Frontend `compareTimeline` sorting by `sequence`
  (`apps/frontend/src/hooks/use-issue-stream.ts:40-55`).
- Memo + structural-equality on `LogEntry`, `ToolGroupMessage`,
  `AcpPlanCard`, `StreamingThinking`, `CompletedThinking`.
- Penetration tests (`4fac2af`) — 15 backend invariants + 5 frontend
  invariants.

### Residual bugs

A deeper review on 2026-05-10 (after the user reported "UI 顺序还是有问题"
and "没法复制原始 markdown 了") identified 8 remaining code bugs and 1
UX regression. Full enumeration in `docs/task/CHAT-002.md`. Repeated
here only at the level needed to anchor the proposal.

#### Files involved

Backend:
- `apps/api/src/engines/timeline-converter.ts` — `nextSequence`,
  `liveConverter`, `toTimeline`, legacy `toTimelineEntry`.
- `apps/api/src/engines/timeline-converter.invariants.test.ts` —
  equivalence test currently skips sequence comparison.

Frontend:
- `apps/frontend/src/hooks/use-issue-stream.ts` — `compareTimeline`,
  `appendServerMessage`, `removeEntries`, scope-change inline block,
  `clearLogs` effect.
- `apps/frontend/src/__tests__/hooks/use-issue-stream.invariants.test.tsx`
  — gap-laden coverage.
- `apps/frontend/src/components/issue-detail/MarkdownContent.tsx` —
  rewrite that broke select-and-copy raw markdown.
- `apps/frontend/src/components/issue-detail/LogEntry.tsx:560-586` —
  Copy button currently `opacity-0 group-hover:opacity-100`.

Shared:
- `packages/shared/src/index.ts` — `TimelineEntry` type (sequence is
  `number | undefined`; we'll require it).

### Cross-impact

- `compareTimeline` sort and `useAcpTimeline` rebuild are downstream
  consumers; they only read `sequence`/`id`.
- `eventBus` SSE forwarding is unchanged (already forwards
  `'timeline-entry'` 1:1).
- No DB schema change.
- No new API endpoints.

## Proposal

Fix in three layers, each gated by tests written first (red → green).

### Layer A — Converter sequence determinism (P0 #1, #3, P1 #5)

**Goal**: live and batch produce byte-identical sequences; sequences are
strictly monotonic across all input orderings; segment ids carry a
zero-padded numeric suffix so any lexicographic tie-break still orders
correctly.

#### A1. Strict monotonic sequence

Replace `nextSequence` with:

```ts
function nextSequence(state: IssueState, entry: NormalizedLogEntry): number {
  const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
  const cand = ts * 1000
  // Strictly greater than any previously-issued sequence for this issue.
  const next = Math.max(cand, state.lastSeq + 1)
  state.lastSeq = next
  return next
}
```

Replace `lastTimestampMs` + `subSeq` fields on `IssueState` with a single
`lastSeq` field.

**Effect**:
- Out-of-order timestamps (P1 #5) no longer regress sequence.
- Same input → same sequence regardless of which TimelineConverter
  instance processes it (so live and batch agree).

#### A2. Zero-padded segment suffix

Buffer ids today: `turn-${turn}-${type}` (suffix 0) or
`turn-${turn}-${type}-${flushCount}`. Change to always include a numeric
suffix, padded to 4 digits:

```ts
const suffix = state.thinkingFlushCount.toString().padStart(4, '0')
state.thinkingBuffer = {
  ...
  id: `turn-${turn}-thinking-${suffix}`,
  ...
}
```

For tool/system/error/user passthrough entries, the id format
(`turn-${turn}-${type}-${idSuffix}`) is unchanged because `idSuffix` is
already a messageId or timestamp (no count collision).

**Effect**: Lexicographic id sort agrees with numeric suffix order up to
9999 segments per turn (effectively unbounded).

**Migration**: Existing rendered ids on live clients become stale during
the deploy window. SSE will start emitting new ids; the client's
`compareTimeline` re-sorts on the next render. Acceptable — at worst
users see a one-frame reorder on deploy.

#### A3. Drop legacy `toTimelineEntry` single-arg export

Verified zero in-source callers. Remove the function and its
`__legacy__` bucket logic. Update the import in
`apps/frontend/src/hooks/use-issue-stream.ts:60` if it still references
this name (frontend already has its own local `toTimelineEntry`).

#### A4. Update equivalence invariant

`apps/api/src/engines/timeline-converter.invariants.test.ts:44-63` —
remove the comment that admits sequence may differ; add:

```ts
expect(stream[i].sequence).toBe(batch[i].sequence)
```

Currently this fails on the captured fixture; A1 makes it green.

#### A5. New invariants

```ts
it('out-of-order timestamps still produce strictly monotonic sequences', ...)
it('20 alternating thinking/tool segments preserve numerical order', ...)
```

### Layer B — Frontend ordering and lifecycle (P0 #2, P1 #4, P2 #7, #8)

#### B1. Optimistic sequence prefers max+1

`appendServerMessage` (`use-issue-stream.ts:258-290`):

```ts
const now = Date.now()
const maxSeq = liveLogsRef.current.reduce(
  (m, e) => (e.sequence ?? 0) > m ? (e.sequence ?? 0) : m,
  0,
)
const sequence = Math.max(maxSeq + 1, now * 1000)
```

When SSE later delivers the canonical entry, `findExisting` matches by
messageId and replaces. The replacement carries the canonical sequence
which (by A1) is also `>= maxSeqAtSendTime + 1`. Position remains at the
bottom regardless of intermediate entries.

#### B2. Drop "legacy first" rule from `compareTimeline`

After A1, every backend-emitted TimelineEntry has a defined sequence.
The local `toTimelineEntry` fallback in `use-issue-stream.ts:78-94`
already synthesizes a sequence. Remove lines 44-46:

```ts
if (sa === undefined && sb !== undefined) return -1
if (sa !== undefined && sb === undefined) return 1
```

Add a runtime invariant in dev mode:

```ts
if (import.meta.env.DEV && sa === undefined) {
  console.warn('Timeline entry missing sequence', a)
}
```

#### B3. Make scope-change effect respect the inline restoration

`use-issue-stream.ts:342-355` currently calls `clearLogs()`
unconditionally on scope change. The inline block at `:152-175` already
performed correct reset + cache restoration during render. Replace the
effect's `clearLogs()` with a no-op (the effect's only remaining job is
setting `streamScopeRef`):

```ts
useEffect(() => {
  if (!issueId || !enabled) {
    streamScopeRef.current = null
    setSessionStatus(externalStatus ?? null)
    clearLogs()
    return
  }
  const scope = `${projectId}:${issueId}:${typesKey}`
  streamScopeRef.current = scope
  // Note: state reset + cache restore happens in the render-time inline
  // block above. The effect must NOT call clearLogs() — that wipes the
  // cache restoration on every scope change.
}, [projectId, issueId, enabled, externalStatus, typesKey])
```

#### B4. New invariants

```ts
it('cache survives scope change — switching issues twice restores liveLogs', ...)
it('user message stays at bottom when system-message arrives between optimistic and canonical', ...)
```

### Layer C — Pending message recall (P2 #9) + markdown copy UX

#### C1. `removeEntries` matches by id OR messageId

`use-issue-stream.ts:292-305`:

```ts
const removeEntries = useCallback((ids: string[]) => {
  if (ids.length === 0) return
  const idSet = new Set(ids)
  const matches = (e: TimelineEntry) =>
    idSet.has(e.id) || (e.messageId !== undefined && idSet.has(e.messageId))
  setLiveLogs(prev => {
    const next = prev.filter(e => !matches(e))
    liveLogsRef.current = next
    return next
  })
  setOlderLogs(prev => {
    const next = prev.filter(e => !matches(e))
    olderLogsRef.current = next
    return next
  })
}, [])
```

#### C2. Make assistant message Copy button discoverable

Two options. **Recommended: option α (minimal)**:

α. **Always-visible-faintly**: Replace
`opacity-0 group-hover:opacity-100` with
`opacity-30 hover:opacity-100`; update tooltip i18n key
`session.copyMessage` → "复制 Markdown 原文" / "Copy markdown source".

β. **Override the copy event**: install a `copy` event listener on the
assistant message div; if the selection is fully contained in the
message, replace `e.clipboardData.setData('text/plain', rawContent)`.
This restores the old "select + Ctrl+C" UX but breaks partial selection
(users can only copy the whole message). Trade-off discussed in
Alternatives.

We propose α. β can be added later if users still complain.

#### C3. New invariant

```ts
it('removeEntries deletes pending message identified by raw messageId', ...)
it('Copy button writes raw markdown source to clipboard, not rendered text', ...)
```

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| A1 changes sequence values for existing in-memory entries on deploy → one-frame reorder for connected clients | High | Low | Acceptable; only visible during the live deploy window. |
| A2 changes segment id format → existing live clients still hold pre-deploy ids | Medium | Low | `findExisting` matches by id; on first SSE event with the new id, the old entry is orphaned and stays at its sequence position; on `onDone` refetch the canonical list replaces. Net result: maybe one duplicate visible for ≤1 turn during the deploy window. Document in the rollout plan. |
| B3 changes scope-change behavior — risk of leaking state across issues | Medium | Medium | The inline render block already calls `setOlderLogs([])` and resets all refs; the effect's `clearLogs()` was redundant. Add an invariant test asserting no cross-issue leakage. |
| C2.α changes a UI element visibility — design feedback risk | Low | Low | The Copy button has been there all along, just opacity:0; bumping to 30% matches the pattern used elsewhere in the chat UI (timestamp opacity). |
| The new equivalence invariant (A4) might fail on some entry classes I haven't accounted for | Low | Medium | Run the test against the captured fixture before landing. If it fails, re-investigate before committing the assertion change. |
| Removing legacy `toTimelineEntry` (A3) breaks an out-of-tree consumer (none in tree) | Very Low | Very Low | Verified by grep — no callers. |

## Scope

- Backend code: `timeline-converter.ts` (~30 LoC modified, ~15 LoC removed).
- Backend tests: `timeline-converter.invariants.test.ts` (~20 LoC modified, ~40 LoC added).
- Frontend code: `use-issue-stream.ts` (~30 LoC modified), `LogEntry.tsx` (~2 LoC modified), `MarkdownContent.tsx` (no code change, only confirms behavior; comment update if needed), i18n files (`en.json`, `zh.json`, ~2 keys).
- Frontend tests: `use-issue-stream.invariants.test.tsx` (~80 LoC added).

Total: ~6 files modified, ~3 files for tests/i18n. ~-15 / +160 net.

No DB migration. No API change. No dependency change.

## Alternatives

### Alt 1: Re-use ULID low-bits as sequence tiebreaker (instead of A1)

Pros:
- Sequence uniqueness derived from ULID's randomness; no shared mutable
  state across paths at all.
Cons:
- ULID low-bits are random, not monotonic within a millisecond. Adjacent
  same-ms entries could re-order. Worse than `Math.max(cand, lastSeq+1)`
  for our purpose (insertion order matters).

Rejected. A1 is simpler and gives a stronger guarantee.

### Alt 2: Markdown copy UX — option β only (override `copy` event)

Pros: restores legacy "select + Ctrl+C → raw markdown" UX.
Cons: breaks partial selection (can only copy whole message); rare edge
cases with nested messages.

Rejected as default; can layer on α later if α proves insufficient.

### Alt 3: Defer P2 fixes (#7 dead code, #9 removeEntries) to a later task

Pros: smaller blast radius.
Cons: #9 is user-visible (recalled pending message lingers); #7 is one-line
removal. Both are cheap and align with the test-coverage push. Bundle.

Rejected.

## Annotations

- 2026-05-10 12:30 — User approved with `开始实现`. Status moved to `implementing`.
- 2026-05-10 12:40 — During Layer A4 verification, the new "streaming === batch
  including sequence" invariant exposed an additional divergence beyond the
  three captured in this plan: `toTimeline` was pre-sorting entries by
  (turnIndex, timestamp) while `liveConverter.ingest` followed wire order.
  With the new `max(ts*1000, lastSeq+1)` formula, that pre-sort produced
  different sequences across paths even before any out-of-order timestamps
  came in. Fixed in scope: removed the pre-sort in `toTimeline` (DB queries
  already return in ULID/wire order; defensive sort was the bug). Recorded
  here for future reference; no plan revision needed.
- 2026-05-10 12:50 — During verification, the existing `use-issue-stream.test.tsx
  > restores trimmed live entries when loading older logs` test failed: it
  emits 510 synthetic TimelineEntries without `sequence`, and the new
  compareTimeline (legacy-first branch removed) collapses them to sequence=0
  with a lexicographic id tiebreak — `turn-10-assistant` sorts before
  `turn-2-assistant`, last entry becomes `msg-9` instead of `msg-509`. Fix:
  every entry now goes through `toTimelineEntry` on the way into liveLogs /
  olderLogs, which synthesizes a sequence when missing. This is a stricter
  invariant than the plan called out (B2 said "rely on backend always sending
  sequence") — but it covers test fixtures and any future regressions in
  upstream emitters. Net change: ~6 LoC in two `setLiveLogs`/`setOlderLogs`
  paths.
- 2026-05-10 12:55 — Verification complete. Backend converter tests: 48/48
  green (was 47 before, +1 net invariant). Frontend tests: 86/86 green (was
  80 before, +6 new invariants). Lint: my changes introduce zero new
  violations; 19 pre-existing errors remain in unmodified files. Status
  moved to `completed`.
