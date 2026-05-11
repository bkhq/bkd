# PLAN-010 Pin TimelineEntry sequence on same-id upsert

- **status**: completed
- **createdAt**: 2026-05-11 11:30
- **approvedAt**: 2026-05-11 11:45
- **completedAt**: 2026-05-11 11:50
- **relatedTask**: CHAT-005

## Context

### Recent history

CHAT-002 / PLAN-007 (2026-05-10) reworked chat ordering end-to-end:

- Backend `TimelineConverter` uses `nextSequence = max(ts*1000, lastSeq+1)`,
  strictly monotonic per issue. `buffer.sequence` is pinned at the first
  chunk and reused for every subsequent chunk of the same buffer
  (`apps/api/src/engines/timeline-converter.ts:73, 192, 265`).
- Live SSE pipeline and batch `/logs` go through the same converter logic
  so sequences are byte-identical across paths.
- Frontend `compareTimeline` sorts by `sequence` then id-lex tiebreaker.
- `appendServerMessage` optimistic sequence is
  `max(maxLiveSeq+1, Date.now()*1000)` so optimistic entries always land
  at the bottom regardless of in-flight loading entries.
- Invariant suite added (86 frontend tests, 48 backend converter tests).

After CHAT-002 landed, the user reports a residual symptom: chat messages
occasionally reorder while a long session runs, with no reliable repro.

### Repro file

`apps/frontend/src/__tests__/hooks/use-issue-stream.reorder-races.test.tsx`
already in the tree, exercising six candidate races. Results:

| Test                                                                       | Result |
|----------------------------------------------------------------------------|--------|
| R1a thinking between two thinking chunks, different sequences              | RED    |
| R1b assistant between two assistant chunks, different sequences            | RED    |
| R2  SSE during in-flight initial /logs fetch                               | green  |
| R2  rapid SSE storm + fetch reconciliation                                 | green  |
| R3  out-of-order SSE arrival sorts by backend sequence                     | green  |
| R4  load-older racing with live SSE                                        | green  |
| R5  trim + straggler + load-older                                          | green  |
| R6  same sequence → id-lex tiebreaker inverts emission order               | RED    |

### Root cause

`useIssueStream.appendEntry` (`apps/frontend/src/hooks/use-issue-stream.ts:234-254`)
replaces an existing entry IN PLACE when `findExisting` matches:

```ts
if (idx >= 0) {
  next = [...prev]
  next[idx] = entry        // ← entire entry replaced, including `sequence`
}
```

`upsertEntry` (`:257-270`) does the same on `log-updated` events.

The backend's `buffer.sequence` invariant ("first chunk's sequence is the
buffer's sequence forever") is enforced server-side but the frontend takes
whatever the new event carries. If any path delivers a same-id update with
a different sequence, the entry's render position drifts.

Audit identified two paths that already CAN drop sequence on the wire:

1. `log-updated` events emit raw `NormalizedLogEntry` (no `sequence`); the
   frontend `onLogUpdated` synthesizes `ts*1000` via `toTimelineEntry`.
   Zero in-source callers today, but the channel is wired end-to-end
   (`apps/api/src/events/issue-events.ts:8`,
   `apps/frontend/src/lib/event-bus.ts`).
2. Any reconnect / multi-tab / dev-mode HMR flow that re-runs the SSE
   handler with cached NormalizedLogEntry can synthesize a sequence
   different from the canonical one originally rendered.

R1a / R1b prove that whenever such a path delivers a same-id update with
a different sequence, the user-visible bug is exactly what the user
reports. Even if the exact production trigger is one we have not
enumerated, the React-state boundary should enforce the same immutability
the backend buffer enforces — that closes the entire class.

### Files in scope

- `apps/frontend/src/hooks/use-issue-stream.ts` — `appendEntry`,
  `upsertEntry`. Two small edits, ~10 lines total.
- `apps/frontend/src/__tests__/hooks/use-issue-stream.reorder-races.test.tsx`
  — verifies the fix (R1a/R1b turn green; R6 remains red intentionally).

## Proposal

### Change

In `appendEntry`, when `findExisting` returns an index AND the matched
entry shares the same `id` as the incoming entry, preserve the existing
`sequence`:

```ts
if (idx >= 0) {
  next = [...prev]
  const existingSeq = prev[idx].id === entry.id ? prev[idx].sequence : undefined
  next[idx] = existingSeq !== undefined ? { ...entry, sequence: existingSeq } : entry
}
```

Same change in `upsertEntry`.

Optimistic→canonical (matched by `messageId`, differing ids) intentionally
takes the canonical sequence — the optimistic sequence
(`max(maxSeq+1, Date.now()*1000)`) is a temporary bottom-anchor whose only
job is "stay at bottom until canonical arrives".

### Invariant

After this fix, the following holds on the frontend:

> Once an entry with id `X` is in `liveLogs` with `sequence: S`, every
> subsequent in-place update keeps `sequence: S`. The only way to change
> `X`'s sequence is to remove and re-add (which a different id would do
> via the `messageId` swap path).

This mirrors the backend's `buffer.sequence` invariant exactly.

### Out of scope

- R6 (same-sequence id-lex tiebreaker). The backend `nextSequence`
  formula prevents ties for backend-emitted entries; if ties ever occur,
  fix the source (cross-instance state divergence) rather than mask with
  a frontend secondary tiebreaker. The test stays red as documentation.
- Removing or reshaping the `log-updated` channel. Out of scope and would
  require a separate audit; this task only ensures the frontend tolerates
  any sequence drift it might deliver.

## Risks

1. **`/logs` refetch path** uses `Map.set` to overwrite by id, bypassing
   `appendEntry`. After this fix, `/logs` continues to install fresh
   canonical sequences from the backend (which are deterministic via
   batch converter). No interaction with the pin rule.
2. **Load-older path** also uses `Map.set` directly. Same — no
   interaction.
3. **Issue-switch LRU restore** sets `liveLogs` from cache directly,
   bypassing `appendEntry`. Cache entries already carry their original
   sequences; no interaction.
4. **Optimistic→canonical swap** matched by `messageId` (different id).
   The pin rule explicitly does NOT apply because ids differ; canonical's
   sequence is used. Invariant test
   `"我的回复直接就没了，刷新就出来了"` continues to pass — the
   optimistic at sequence `maxSeq+1` is replaced by canonical at the
   backend's strictly-larger sequence, and the test asserts position,
   not sequence value.
5. **`metadata.streaming` transitions** (chunk → closing entry). Same id,
   same backend sequence — the pin rule is a no-op here in practice; if
   backend's closing entry ever carried a different sequence (which it
   does not today), we'd correctly preserve the prior sequence and avoid
   the buffer "jumping" at close time.

## Verification

- `bunx vitest run src/__tests__/hooks/use-issue-stream.reorder-races.test.tsx`
  — R1a, R1b green; R2/R3/R4/R5 remain green; R6 remains red
  (intentional, documented).
- `bunx vitest run src/__tests__/hooks/use-issue-stream.test.tsx`
  `src/__tests__/hooks/use-issue-stream.invariants.test.tsx`
  — all green (covers optimistic-bottom, LRU cache survival, pending
  recall, etc.).
- `bunx vitest run` (full frontend) — 86+ tests green.
- `bun --filter @bkd/frontend lint` — no new violations.
- Manual smoke: long chat session with multiple tool-uses sandwiched in
  long thinking — order stable across run, refresh, and reconnect.

## Alternatives considered

1. **Fix `emitIssueLogUpdated` to attach sequence**: would address the
   one identified path but not the unknown ones; doesn't extend the
   immutability invariant to the frontend. Treat as separate work if a
   caller is ever added.
2. **Frontend "monotonic insertion counter" tiebreaker**: helps R6 but
   not R1. Adds state and complexity; R6's root cause is upstream
   sequence collision, which the backend already prevents.
3. **Snapshot diffing**: detect when a new entry's sequence differs from
   the existing and log a warning. Helpful for future debugging but
   doesn't fix the reorder.
