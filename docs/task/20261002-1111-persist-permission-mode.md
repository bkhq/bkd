# 20261002-1111-persist-permission-mode Persist the issue permission mode

- **status**: completed
- **priority**: P1
- **owner**: claude/session-audit-fixes
- **createdAt**: 2026-10-02 11:11

## Description

`permissionMode` (`auto` / `supervised` / `plan`) is accepted by issue create,
execute and follow-up but never stored. Paths that have no request to read it
from fall back to the engine default, which is `auto` for every built-in
engine: auto-retry (`spawnRetry`), restart, the pending-message flush, and the
execute triggered by moving an issue to `working`. An issue started in `plan` or
`supervised` is therefore re-run with full permissions after a failure.

Acceptance:

- The mode chosen at create, execute or follow-up is stored on the issue.
- Retry, restart, pending flush and status-triggered execute use the stored
  mode when the request carries none.
- Tests cover create -> execute, restart, and a follow-up changing the mode.

## ActiveForm

Persisting the issue permission mode

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261002-1111-persist-permission-mode.md`. Found by the 2026-10-02 audit
of the issue-creation flow and process management.

- complete: New tests pass; lint and API typecheck pass. Full API suite: 764 pass, 1 failure in api-execution.test.ts that is the known order-dependent flake (task 20261002-1046-api-execution-concurrency-flake). Frontend tests and build not run (no frontend change).
