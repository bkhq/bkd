# CRON-004 Stop serving soft-deleted cron jobs over the API

- **status**: completed
- **priority**: P1
- **owner**: roy
- **createdAt**: 2026-09-08 00:00

## Description

`GET /api/cron` without query parameters returns every row, soft-deleted ones
included, and the cron page renders them in a collapsible "deleted jobs"
section. Soft deletion is a storage detail; a deleted job should disappear from
the API surface entirely.

Acceptance criteria:

- `GET /api/cron` never returns a row with `is_deleted = 1`, in both the
  unpaginated and the paginated response shape.
- The `deleted` query parameter is gone from the route and from the OpenAPI
  contract.
- The serialized cron job no longer carries `isDeleted`.
- `GET /api/cron/:jobId/logs` returns 404 for a soft-deleted job, like every
  other per-job route.
- The cron page has no deleted-jobs section and no deleted-job styling.
- Focused API and frontend tests pass, followed by repository lint, typecheck,
  and build verification.

## ActiveForm

Removing soft-deleted cron jobs from the API and the cron page

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

This deliberately reverses two CRON-002 acceptance criteria ("deleted jobs
remain visible in the existing deleted-jobs section", "deleted jobs do not
expose another delete control"). Log retention for deleted jobs was already
nominal: the `log-cleanup` builtin purges every log of a soft-deleted job on its
next run.

## Verification

- Focused API cron tests: 4 passed (2 new: list omits soft-deleted jobs in both
  response shapes; logs 404 for a soft-deleted job).
- Focused frontend cron tests (page, API client, delete hook): 12 passed.
- Full API suite: 639 passed, 1 skipped, 0 failed.
- Full frontend suite: 95 passed, 0 failed.
- API typecheck (`tsc --noEmit -p apps/api`): clean.
- Frontend build (`tsc -b && vite build`): passed.
- Repository lint: 0 errors, 2 pre-existing warnings in
  `AppSettingsDialog.tsx` / `ProjectSettingsDialog.tsx`.
- `git diff --check` passed.
