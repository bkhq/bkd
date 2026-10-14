# 20261013-1950-engine-protocol-drift Fix Claude and Codex wire-protocol drift

- **status**: completed
- **createdAt**: 2026-10-13 19:50
- **approvedAt**: 2026-10-13 20:03
- **relatedTask**: 20261013-1950-engine-protocol-drift

## Context

Captured wire traces and the exported Codex schema were replayed through the
normalizers; every finding below was re-checked against the code.

Claude (`apps/api/src/engines/executors/claude/`):

- `normalizer.ts` `parseResult` copies `total_cost_usd` into `metadata.costUsd`,
  and `issue/pipeline/token-usage.ts` adds `costUsd` to `issues.totalCostUsd`
  for every `turnCompleted` entry. `total_cost_usd` is cumulative for the
  process, and one prompt now yields several results (subagents are async, the
  CLI re-runs when they report back). Captured: 0.0099 / 0.0105 / 0.0105, BKD
  stores 0.0309, real spend 0.0105. `result.usage` is per result, so token
  totals are already correct.
- The third captured result has `num_turns: 0`, `duration_ms: 3`,
  `origin.kind: "task-notification"` and renders as `0.0s · $0.0105`.
- The wire type is `rate_limit_event`; the switch only knows `rate_limit`, so
  the line falls to `parseUnknown` and is dropped. The captured event has
  `rate_limit_info.status: "allowed"`, i.e. it is sent on healthy calls too.
- One normalizer instance is created per spawned process
  (`createLogNormalizer` in `execute.ts`, `restart.ts`, `lifecycle/spawn.ts`),
  so per-process state can live on the instance.

Codex (`apps/api/src/engines/executors/codex/`):

- `protocol.ts` `trackNotification` reads `params.turnId` on `turn/started`;
  the wire sends `params.turn.id`. Masked today by the `turn/start` response.
- `normalizer.ts` `handleThreadStarted` reads `params.threadId`; the wire
  sends `params.thread.id`, so metadata `threadId` is always undefined.
- `extractCommandString` returns `item.command`, now
  `/usr/bin/bash -c '<script>'`; the bare script is in
  `commandActions[0].command`. Display and command classification both use
  the wrapped string.

## Proposal

1. Claude cost delta. `ClaudeLogNormalizer` keeps `lastTotalCostUsd`. For a
   result carrying `total_cost_usd`, `costUsd = total - last` (a total below
   the previous one is treated as a fresh baseline), then `last = total`.
   Legacy top-level `cost_usd` stays a per-turn value. The chat line shows the
   same delta. `token-usage.ts` is unchanged.
2. Claude empty result. When `num_turns === 0` and
   `origin.kind === 'task-notification'`, emit the entry with empty content
   (same shape as the existing `session_state_changed` entry) so
   `turnCompleted` still reaches settlement. Add `origin`, `result_index` to
   `ClaudeResult`.
3. Claude rate limit. Route `rate_limit_event` to `parseRateLimit`; return
   `null` unless `rate_limit_info.status === 'rejected'`. Events without a
   status (legacy `rate_limit`) keep today's behaviour.
4. Codex `turn/started`: read `params.turn.id`, fall back to `params.turnId`.
5. Codex `thread/started`: read `params.thread.id`, fall back to
   `params.threadId`.
6. Codex command: when `commandActions` has exactly one entry with a string
   `command`, prefer it over `item.command`; otherwise keep `item.command`.

Tests first (RED), from the captured shapes: `claude-normalizer.test.ts`
(three-result sequence, empty result, `rate_limit_event` allowed/rejected),
`codex-protocol.test.ts` (`turn/started` with nested turn),
`codex-normalize-log.test.ts` (`thread/started`, wrapped command).

## Risks

- Cost delta relies on one normalizer per process. If an instance were ever
  reused across processes, the "total dropped" reset covers a restart but a
  new process whose first total exceeds the old one would be under-counted.
- Historical `totalCostUsd` values stay inflated; no backfill is planned.
- `allowed_warning` rate-limit states are not shown. Deliberate: nothing in
  the UI consumes them today.
- Multi-action commands (`a && b` split into several `commandActions`) keep
  the wrapped string; joining the actions would lose the operators.

## Scope

Four source files (`claude/normalizer.ts`, `claude/normalizer-types.ts`,
`codex/protocol.ts`, `codex/normalizer.ts`) and three test files. No schema,
API contract, or frontend change.

## Alternatives

- Fix the cost in `token-usage.ts` by storing the last cumulative value per
  issue: needs process identity in the pipeline and a reset on every spawn;
  the normalizer already has the right lifetime.
- Use `modelUsage[*].costUSD`: also cumulative, same problem.
- Strip the `bash -c` wrapper by parsing `item.command`: quoting rules make
  this fragile when the CLI already supplies the bare command.

## Annotations

(none)
