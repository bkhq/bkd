# 20261011-0213-codex-failure-visibility Surface Codex turn failures and stop stall probes from ending Codex turns

- **status**: completed
- **createdAt**: 2026-10-11 02:13
- **approvedAt**: 2026-10-11 12:32
- **relatedTask**: 20261011-0213-codex-failure-visibility

## Context

Evidence from the production install (`/srv/bkd/data/db/bkd.db`,
`/srv/bkd/data/logs/bkd.log`, BKD 0.3.5, Codex CLI 0.158–0.162):

| Signal | Count (45 d) | Where it goes today |
|---|---|---|
| Codex `error` with `errorKind: cyberPolicy` | 16 (1 issue) | `error-message` — hidden |
| Codex `error` `responseStreamDisconnected` ("Reconnecting… n/5", willRetry) | 8 (2 issues) | hidden |
| `turn/completed status=failed` | 8 (1 issue) | `error-message` — hidden; settles `failed` → review |
| `turn/completed status=interrupted` | 2 | one from a user cancel, one from the stall probe |
| `thread/status/changed systemError` | with every failed turn | hidden |
| stall probe (`stream_stall_probe_sent`) | 32 (31 Claude, 1 Codex) | Codex: turn interrupted and settled `failed` |
| `deprecationNotice` on `thread/resume` | 13 | logged only |
| idle kill 30 min after the last turn | expected | — |

- `utils/visibility.ts`: `if (entry.entryType === 'error-message') return false`
  (cc74551, "suppress error-message entries from SSE and query results"). The
  frontend still has a renderer for `error-message` (`LogEntry.tsx`) and lets
  them through after `done` (`use-issue-stream.ts:439`) — the API never sends
  them. Stderr lines (`consumeStderr` → `pushStderrEntry`) are the noise that
  rule was written for (Codex's bubblewrap warning on every spawn, tracing
  output).
- `pipeline/failure-detect.ts`: `resultSubtype !== 'success'` ⇒ logical
  failure unless `managed.lastInterruptAt` is set. `gc.ts` stall tier 2 calls
  `protocolHandler.interrupt()` without setting it, so a probe-interrupted
  Codex turn settles `failed`. For Claude the interrupt is a probe the CLI
  survives; for Codex `turn/interrupt` ends the turn.
- `executors/codex/protocol.ts` `resumeThread` re-sends the thread params but
  not `excludeTurns`; the response hydrates full history BKD never reads.
- Protocol check (0.162.1 schema, offline handshake with BKD's params): no
  breaking change; sub-agent threads are not observed in production logs
  (`parentThreadId` never non-null).
- The `cyberPolicy` block is Codex-side policy: security-audit prompts are
  refused unless the account has Daybreak access
  (`CyberAccessProgram`: `standard | daybreakBlue | daybreakRed`, server-gated).
  BKD cannot bypass it; it can only show the reason.

## Proposal

1. Visibility: hide only raw stderr. `pushStderrEntry` tags entries with
   `metadata.source: 'stderr'`; `isVisible` hides `error-message` entries
   with that tag and shows all others. The SSE gate (`routes/events.ts`) and
   the DB post-filter share `isVisible`, so one change covers both.
2. Codex stall handling (`gc.ts`): for `engineType === 'codex'` skip the
   tier-2 interrupt probe; keep tier 1 (dead-process check) and replace tier 3
   with the keepAlive-style cap (`KEEPALIVE_STALL_TIMEOUT_MS`, 30 min of
   silence with a live process → kill + `failed`). The `failure-detect` change
   considered for probe-caused interrupts is dropped: the consumer clears
   `stallProbeAt` before the pipeline runs, and with Codex no longer probed
   there is no engine left where a probe ends the turn.
3. `resumeThread`: add `excludeTurns: true`.
4. Frontend: no new UI; the existing `error-message` renderer shows the entries.
   Add `errorKind` to the rendered line when present so "cyberPolicy" /
   "contextWindowExceeded" / "usageLimitExceeded" are readable (i18n keys in
   both locales).

## Tests (RED first)

- `visibility`: stderr-tagged error hidden; Codex `error` / failed turn /
  thread systemError visible; Claude `error` visible.
- `gc-stall-detection.test.ts`: a silent Codex process is not interrupted at
  tier 2; killed after the long cap; a Claude process keeps today's path.
- `codex-protocol.test.ts`: `thread/resume` carries `excludeTurns: true`.
- frontend `LogEntry` test: errorKind label rendered.

## Risks

- Showing errors adds red boxes users have not seen for months, including
  transient "Reconnecting… n/5" notices that Codex recovers from. Acceptable:
  that is what happened; the alternative is the current silent failure.
- A genuinely hung Codex process now lives up to 30 min before BKD kills it
  (today 7 min). The process is idle on the API side, so the cost is a slot,
  not tokens.

## Scope

`engines/issue/utils/visibility.ts`, `engines/issue/streams/consumer.ts`,
`engines/issue/gc.ts`, `engines/issue/pipeline/failure-detect.ts`,
`executors/codex/protocol.ts`, `components/issue-detail/LogEntry.tsx`, i18n
(en/zh), tests, changelog. No schema or API contract change.

## Alternatives

- Keep errors hidden and show only a toast with the last error: loses the
  per-turn history and the "Reconnecting" context; rejected.
- Use `turn/steer` to deliver mid-turn messages immediately instead of
  queueing them until the turn ends: a UX improvement, independent of this bug;
  record as a separate P2 task if wanted.
- Switch Codex from `app-server` to `codex exec --json`: no benefit — the
  failures are policy/stream errors reported identically by both.

## Annotations

(none)
