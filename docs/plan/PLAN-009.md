# PLAN-009 OpenCode assistant/thinking double-emit fix via `dbOnly` pipeline lane

> Created: 2026-05-10
> Task: [CHAT-003](../task/CHAT-003.md)
> Status: completed

## Problem

When OpenCode (an ACP agent) finishes a turn:

1. Streaming `agent_message_chunk` / `agent_thought_chunk` events have already accumulated into `liveConverter`'s per-issue `assistantBuffer`/`thinkingBuffer`. Each chunk emits a `streaming:true` `TimelineEntry` upsert with id `turn-N-assistant-0000` (or `thinking-0000`). The frontend renders those as raw text (markdown is gated behind `streaming:false` to avoid mid-stream remount churn).
2. `acp-prompt-result` arrives. The normalizer's handler (`acp/normalizer.ts:657-675`) returns an array of `NormalizedLogEntry` produced by `flushAssistantMessage` / `flushThinkingMessage` / `flushOutstandingToolResults` plus a closing system-message.
3. Those flushed entries have NO `streaming` flag → they flow to the persist stage (DB write — desired) AND to the timeline-emit stage.
4. In timeline-emit they re-enter `liveConverter.ingest`. Because the return array order is `[..tools, thinkingFlush, assistantFlush, system]`:
   - The thinking flush enters first; if `assistantBuffer` is still open from streaming, lines 250-257 close it and `assistantFlushCount++`.
   - The assistant flush enters next; `assistantBuffer` is now null, so a NEW buffer opens with id `turn-N-assistant-${segmentSuffix(1)}` = `turn-N-assistant-0001`.
   - Same for thinking when assistant streaming was interrupted by thinking earlier.
5. Frontend now sees TWO assistant entries with different ids → renders two bubbles. The streaming one keeps its raw-text appearance because its closing snapshot has `streaming:false` (good) but its content stops at whatever the thinking-interrupt cut off (= the "先从第" stub when followed by another thinking interrupt). The flush-emit one carries the full merged markdown.

## Constraints

- DB persist stage (`pipeline/persist.ts`) intentionally drops `streaming:true` entries. The full merged assistant/thinking entry produced by the normalizer's flush is the **only** thing that lands in `issue_logs`. It cannot be removed without redesigning persistence.
- The streaming chunks must continue to upsert in place during the turn (no flicker for users watching the stream).
- Claude (`stream-json`) and Codex (`json-rpc`) normalizers must remain unaffected — they don't use the same flush re-emit pattern.

## Approach

Introduce a `metadata.dbOnly: boolean` flag on `NormalizedLogEntry`. The normalizer flags any entry that is "the final, merged content meant only for DB persistence and downstream history". The timeline-emit pipeline stage early-returns on `dbOnly === true`, preventing those entries from re-entering `liveConverter`.

This:

- Lets the persist stage write the full merged content as before (it ignores no flag besides `streaming`).
- Keeps the streaming buffer in `liveConverter` as the sole source of timeline entries for the turn. Closing happens naturally via the trailing system-message at `acp-prompt-result` (which is non-thinking/non-assistant → falls through to lines 312-321 of `timeline-converter.ts` and closes both buffers with `streaming:false`).
- Adds zero new state: the converter is unchanged.

### Why not just remove the flush re-emit?

Because then the persist pipeline gets nothing for assistant/thinking — the DB row stays empty. We'd have to wire the persist stage to subscribe to the `timeline-entry` channel and reconstruct content from closed buffers, which is a much larger redesign and entangles two stages that today have a clean cut.

### Why not stop the converter from opening a new segment when content matches?

That's a content-equality check inside the converter that would need to handle "matches existing buffer prefix" / "matches buffer + a tail" — error-prone and would mask other classes of bugs. The flag is a clean signal of intent.

## Implementation Steps

### Step 1 — Define the `dbOnly` flag (shared types)

`packages/shared/src/index.ts` — extend `NormalizedLogEntry['metadata']` typing if it has a typed shape. If metadata is `Record<string, unknown>`, no change needed; otherwise add `dbOnly?: boolean`.

### Step 2 — Flag normalizer flush entries

`apps/api/src/engines/executors/acp/normalizer.ts`:

- `flushAssistantMessage` → set `metadata: { dbOnly: true }` on the returned entry.
- `flushThinkingMessage` → same.
- `flushOutstandingToolResults` is not affected (tool results do enter the timeline; they're the source of the rendered tool blocks).

### Step 3 — Skip in timeline-emit

`apps/api/src/engines/issue/pipeline/timeline-emit.ts:23-48`:

```ts
if (data.entry.metadata?.dbOnly === true) return
```

Place before the existing streaming/visibility filters. Comment why.

### Step 4 — Tests

- `apps/api/src/engines/timeline-converter.invariants.test.ts` — add: a synthetic ACP turn (chunks → `flushAssistantMessage`-style entry with `dbOnly:true`) routed through a mock pipeline asserts only one assistant `TimelineEntry` id is produced. Variant: with thinking interrupts.
- New: `apps/api/src/engines/issue/pipeline/timeline-emit.test.ts` (if missing) — assert `dbOnly:true` entries do not invoke `liveConverter.ingest`.

### Step 5 — Verify Claude / Codex paths

Grep both normalizers for any flush re-emit / final-content emission. Confirm they either already use `streaming:false` correctly without re-entry to converter, or do not exist (each engine takes a different path).

## Verification

- `bun --filter @bkd/api test` — all existing tests pass + new ones added.
- `bun --filter @bkd/api lint`.
- `bun --filter @bkd/frontend test` — sanity (no shape change to `TimelineEntry`).
- Manual: run an OpenCode session, observe single-bubble rendering on simple turn; observe segment behavior on thinking-mid-answer turn (still one segment per natural break, not extra flush segment).

## Risk

Low. The change is additive (`dbOnly` flag) with a single early-return guard. Pipeline stages are independent so the flag's effect is fully scoped to timeline-emit.

Edge case to verify: turns with NO assistant content (only thinking, or only tools). The system-message closing at `acp-prompt-result` should still close any remaining buffer; otherwise `liveConverter.flush(issueId)` at settle time will. Already covered by existing flush-on-settle path.

## Out of scope

Cursor-style visual merge of multiple natural assistant segments per turn into one bubble. Documented in CHAT-003 as a possible follow-up if UX still undesirable after this fix.
