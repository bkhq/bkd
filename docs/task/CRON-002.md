# CRON-002 Add persistent cron job deletion to the UI

- **status**: completed
- **priority**: P1
- **owner**: roy
- **createdAt**: 2026-08-20 19:55

## Description

Expose the existing cron soft-delete API in the cron management page and make
deletion persistent for built-in jobs across service restarts.

Acceptance criteria:

- Active cron job cards and the active job detail header expose an accessible
  delete control.
- Deletion requires explicit confirmation and identifies the selected job.
- Confirming deletion calls `DELETE /api/cron/:jobId`, refreshes the cron job
  query, and removes the job from the active list.
- Deleted jobs retain their execution logs and remain visible in the existing
  deleted-jobs section.
- A deleted built-in cron job is not recreated on the next scheduler startup.
- Deleted jobs do not expose another delete control.
- Focused API and frontend tests pass, followed by repository lint, typecheck,
  and build verification.

## ActiveForm

Adding persistent cron job deletion controls and verification.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Investigation found that `DELETE /api/cron/:jobId` already soft-deletes the row,
removes it from Baker, and preserves logs. The frontend has no API wrapper,
mutation hook, or delete control. `ensureDefaultJobs()` currently checks only
non-deleted rows, so deleted built-in jobs are recreated after restart.

- 2026-08-20 19:55 — PLAN-014 approved; implementation started.
- 2026-08-20 20:03 — Implementation and verification completed.

## Verification

- Focused API cron tests: 2 passed.
- Focused frontend delete/API/hook/page tests: 11 passed.
- Full API suite: 595 passed, 1 skipped, 0 failed.
- Full frontend suite: 47 passed, 0 failed.
- Frontend typecheck and production build passed.
- Repository lint passed with 0 errors and 4 pre-existing warnings.
- Standalone API typecheck still reports five pre-existing test typing errors in
  `api-issues.test.ts` and `pipeline-context-usage.test.ts`; none involve cron
  code or files changed by this task.
- `git diff --check` passed.
