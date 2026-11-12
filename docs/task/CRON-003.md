# CRON-003 Add one-click cron history cleanup

- **status**: completed
- **priority**: P1
- **owner**: claude/session-cron-history
- **createdAt**: 2026-08-21 01:30

## Description

Add a destructive one-click cleanup flow to the cron management page. The
cleanup permanently removes soft-deleted cron jobs and their associated logs,
and removes completed execution logs from active cron jobs while preserving
currently running executions.

Acceptance criteria:

- The cron page exposes an accessible cleanup-history action with an explicit
  destructive confirmation.
- One request atomically hard-deletes every soft-deleted cron job and all logs
  that reference those jobs.
- Completed logs for active cron jobs are deleted; `running` logs for active
  jobs are retained.
- Cleaning a deleted built-in cron job does not cause that default job to be
  recreated on the next scheduler startup.
- The API returns separate deleted-job and deleted-log counts; the UI reports
  those counts and refreshes cron data.
- Repeated cleanup is safe and returns zero counts when there is nothing left
  to clean.
- Focused backend and frontend tests cover cleanup scope, default suppression,
  confirmation, request dispatch, and query invalidation.

## ActiveForm

Adding one-click cron history cleanup with persistent default suppression

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

CRON-002 currently uses soft-deleted cron rows as tombstones to prevent deleted
built-in defaults from being reseeded. Hard cleanup must persist those default
names in `app_settings` before removing their rows, otherwise cleanup would
silently undo deletion after restart.

- unclaim: Handed over on the owner's instruction to implement PLAN-015.

- complete: Implemented per PLAN-015 without VACUUM; lint, typecheck, tests, build and a browser check of the cron page pass.
