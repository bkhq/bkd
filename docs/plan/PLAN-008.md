# PLAN-008 Preserve Codex tool actions for grouping

- **status**: completed
- **createdAt**: 2026-05-11 00:00
- **approvedAt**: 2026-05-11 00:00
- **relatedTask**: ENG-005

## Context

Codex app-server emits `item/started` for tool actions and `item/completed`
for tool results. The frontend groups tool messages by first buffering
non-result tool action entries and pairing results by `toolCallId`.

The current Codex normalizer marks started tool action entries as streaming.
Both the persistence stage and ExecutionStore stage skip streaming entries, so
the frontend receives unpaired result entries after reload or log query. Those
unpaired results are flushed as standalone tool groups.

## Proposal

Treat Codex `item/started` tool action entries as durable non-streaming entries.
Keep `item/commandExecution/outputDelta` and `item/fileChange/outputDelta`
streaming because those are intermediate result deltas.

## Risks

- Started tool actions will now be persisted even if the process exits before a
  result arrives. That is consistent with the frontend's active/incomplete tool
  group model.
- Existing historical logs that already lost action entries are not repaired by
  this change.

## Scope

- Runtime change: `apps/api/src/engines/executors/codex/normalizer.ts`
- Test change: `apps/api/test/codex-normalize-log.test.ts`
- PMA tracking updates for `ENG-005` and `PLAN-008`

## Alternatives

- Teach the frontend to group result-only entries. That hides the root cause
  and loses tool input/intent data.
- Persist all streaming entries. That would add noisy assistant/text deltas and
  is broader than the bug requires.

## Annotations

- 2026-05-11: Investigation found Codex `item/started` tool actions are marked
  streaming and skipped by DB/ExecutionStore stages, leaving result-only logs.
- 2026-05-11: Implemented by preserving started tool actions as non-streaming
  entries while leaving output delta entries streaming.
