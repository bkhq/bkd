# 20261001-1313-reconciler-start-race Keep the stale-working reconciler away from executions that are starting

- **status**: completed
- **priority**: P1
- **owner**: claude/session-main
- **createdAt**: 2026-10-01 13:13
- **approvedAt**: 2026-10-01 13:05

## Description

An issue shows `sessionStatus: failed` and `statusId: review` while its engine
process runs a whole turn. Clients show a failed issue in Review that is visibly
still working; the state only corrects itself when that turn settles.

`reconcileStaleWorkingIssues()` treats an issue as stale when it is `working`
and `hasActiveProcess(issueId)` is false. An execution that is *starting* is
already `working` but has no registered process yet:

1. The caller moves the issue to `working` (`ensureWorking()`).
2. The engine operation later takes the issue lock, writes
   `sessionStatus: 'running'`, then awaits the executor's spawn (CLI start-up,
   session resume, worktree checks — 2.9 s in the observed case).
3. `register()` only runs after the spawn resolves.

A pass landing between 1 and 2 moves the issue back to `review`; a pass landing
between 2 and 3 writes `failed` + `review`. The reconciler skips only `pending`,
which every engine path overwrites with `running` before spawning, and the
existing TOCTOU re-check cannot help because the process is still unregistered.

Measured on the server log 2026-07-25..2026-10-01: 101 `reconciler_moved_to_review`
entries, 68 with `previousSessionStatus: running`, 66 of those followed within
0-10 s by a spawn for the same issue — about 3% of the 2,032 starts, rising with
concurrency.

Secondary defect: when the reconciler sets `sessionStatus: 'failed'`, its
`issue-updated` event carries only `{ statusId: 'review' }`, so a client applying
the event keeps showing the old session status until it refetches.

Full investigation and the approved proposal: upstream issue text supplied by the
reporter; evidence from the BKD server log (`~/bkd/data/logs/bkd.log`), extracted
events in `~/warehouse/bkd-reconciler-race/events.log`.

Acceptance criteria:

- `EngineContext` tracks starts in progress per issue; `issueEngine.trackStart()`
  increments synchronously, awaits, and decrements in `finally`;
  `issueEngine.isStarting()` reports it.
- Every start is wrapped from just before its first write that puts the issue in
  `working` until the engine operation returns: the follow-up route, the execute
  and restart routes, the cron follow-up and execute actions,
  `flushPendingAsFollowUp()` and `triggerIssueExecution()`.
- `reconcileStaleWorkingIssues()` skips an issue when it has an active process
  **or** a start in flight, both in the first pass and in the re-check before the
  transaction.
- The `issue-updated` event carries `sessionStatus: 'failed'` for the issues
  whose session status the reconciler rewrote.
- Genuinely stale issues still move to `review` + `failed`; existing reconciler
  tests keep passing.

## ActiveForm

Keeping the reconciler away from executions that are starting

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- No schema change and no API change.
- Risk accepted: a wrap that never releases would hide a truly stale issue.
  `finally` releases on every path, the counter is in memory so a restart clears
  it, and `startupReconciliation()` still repairs everything at start.
- Rejected alternatives (from the proposal): keeping `pending` until `register()`
  (clients would show pending through the whole spawn, and the window before the
  lock stays open); having the reconciler take the issue lock per candidate (does
  not cover the gap before the lock, and makes a pass wait on busy issues);
  skipping issues updated in the last N seconds (a timing guess that fails on
  slow spawns).

- complete: `bun run test:api` 747 pass / 1 fail, `bun --filter @bkd/api lint`,
  `bun run typecheck`. New `test/reconciler-start-race.test.ts` (8 cases) plus the
  existing reconciler and issue-lock suites pass. The one failure is
  `Auto-execute on issue creation > async execution transitions to running then
  completed`; it reproduces with the change stashed and passes when its file runs
  alone, i.e. the pre-existing order-dependent flake tracked as
  20260922-1712-api-execution-suite-order-flake.
- `test/issue-lock.test.ts` builds an `EngineContext` literal, so it needed the
  new `startsInFlight` field.
