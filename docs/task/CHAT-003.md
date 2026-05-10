# CHAT-003 Eliminate OpenCode double-emit assistant/thinking bubbles

- **status**: completed
- **priority**: P1
- **owner**: Weifashi
- **createdAt**: 2026-05-10 23:50

## Description

When OpenCode is the backend engine, every turn's assistant/thinking content is rendered to the user as **two bubbles** instead of one:

- The streaming buffer (`turn-N-assistant-0000`, `streaming:true` while live) renders as raw text without markdown.
- The same content reappears below as a fully markdown-rendered second bubble (`turn-N-assistant-NNNN`, the `flushAssistantMessage` re-emit).

When `agent_thought_chunk` interleaves mid-answer (OpenCode's reasoning models do this routinely), the streaming side is further split into multiple segments — leaving short tail stubs like "先从第" as orphaned bubbles next to the final flushed bubble.

### Root cause

Two layers maintain parallel accumulation/flush state and BOTH feed the timeline:

- `apps/api/src/engines/executors/acp/normalizer.ts` — `assistantTextParts`/`thinkingTextParts` + `mergeStreamingParts` + `flushAssistantMessage`/`flushThinkingMessage`. Required: it produces the only `streaming:false` entry the DB persist stage (`pipeline/persist.ts:26`) accepts.
- `apps/api/src/engines/timeline-converter.ts` — `assistantBuffer`/`thinkingBuffer` + `mergeChunk`. Required: it produces per-chunk `TimelineEntry` upserts the SSE pipeline broadcasts.

At `acp-prompt-result`, normalizer's flush returns NEW `NormalizedLogEntry` instances (full merged content, no `streaming` flag). Those entries flow to BOTH stages:

- Persist (correct — this is the DB write)
- Timeline-emit (incorrect — re-enters `liveConverter.ingest`, which sees them as fresh assistant/thinking entries and opens new segments because the array's `flushThinking → flushAssistant` order forces `assistantFlushCount++` between them)

Result per turn: streaming-segment(s) + flushed-segment(s) = 2-N visible bubbles.

### Acceptance Criteria

- [x] `acp-prompt-result` flush entries reach the DB persist stage but **not** the timeline-emit stage
- [x] After the fix: a thinking-only-then-assistant turn produces exactly one thinking + one assistant TimelineEntry id (no `-0001` re-emit segment)
- [x] After the fix: a thinking-assistant-thinking-assistant interleaved turn still produces one TimelineEntry id per "natural segment" — no extra flush segment
- [x] DB still receives the full merged assistant/thinking content (history reload shows complete content) — persist stage unchanged, only timeline-emit stage filters
- [x] No regression on Claude (`stream-json`) or Codex (`json-rpc`) — both have `streaming:false` finalize paths that already worked correctly; neither emits `dbOnly` so the new guard is a no-op for them
- [x] New invariant test: synthetic OpenCode turn with `flushAssistantMessage` after thinking interrupt produces no extra segment (`apps/api/test/acp-client.test.ts` — "flushes thinking and assistant with dbOnly:true on turn completion (CHAT-003)")
- [x] New unit test: timeline-emit pipeline stage skips entries flagged `metadata.dbOnly === true` (`apps/api/src/engines/issue/pipeline/timeline-emit.test.ts` — 4 cases)

### Out of scope (deferred)

Visual merge of multiple natural assistant segments (caused by genuine thinking-mid-answer interleaving) into ONE Cursor-style bubble with inline thinking blocks. After this fix the remaining segments are all properly markdown-rendered and behave per the existing "Multi-segment thinking/assistant per turn" design — the bug-class symptom (raw text + duplicate markdown + truncation stub all visible together) is gone. If the multi-segment-per-turn UX is still undesirable, a follow-up frontend grouping task is needed.

## ActiveForm

Fixing OpenCode double-emit assistant/thinking bubbles

## Dependencies

- **blocked by**: (none — builds on CHAT-002 ordering work)
- **blocks**: (none)

## Notes

Branch `fix/chat-003-opencode-double-emit` off `fix/chat-002-residual-ordering` (depends on its strict-monotonic `nextSequence` + 4-digit `segmentSuffix`).

Plan: `docs/plan/PLAN-009.md`.

Files expected to change:

- `apps/api/src/engines/executors/acp/normalizer.ts` — flag `flushAssistantMessage`/`flushThinkingMessage` output with `metadata.dbOnly = true`.
- `apps/api/src/engines/issue/pipeline/timeline-emit.ts` — early-return on `entry.metadata?.dbOnly === true`.
- `apps/api/src/engines/timeline-converter.invariants.test.ts` (or new file) — invariant + regression tests.
