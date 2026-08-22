# PLAN-014 Add persistent cron job deletion

- **status**: completed
- **createdAt**: 2026-08-20 19:55
- **approvedAt**: 2026-08-20 19:55
- **relatedTask**: CRON-002

## Context

The backend already registers `DELETE /api/cron/{jobId}` in
`apps/api/src/openapi/routes.ts` and implements it in
`apps/api/src/routes/cron.ts`. The handler resolves a non-deleted job by ID,
sets `isDeleted=1`, stops and removes the Baker job, and leaves
`cron_job_logs` intact. The default `GET /api/cron` response includes deleted
rows, and `CronPage.tsx` already separates them into a collapsed deleted-jobs
section.

The missing call chain is frontend-only:

- `apps/frontend/src/lib/kanban-api.ts` has pause/resume methods but no cron
  delete method.
- `apps/frontend/src/hooks/use-kanban.ts` has pause/resume mutations but no
  deletion mutation or cron-list invalidation for deletion.
- `apps/frontend/src/pages/CronPage.tsx` renders pause/resume controls but no
  delete affordance or confirmation flow.
- Cron translations have no delete confirmation strings.

There is one backend persistence gap. `ensureDefaultJobs()` in
`apps/api/src/cron/index.ts` checks for a non-deleted default by name. A
soft-deleted built-in job therefore gets inserted again when the scheduler
restarts, making deletion temporary for built-in jobs.

No cron-specific API or frontend tests currently exist. The repository also
does not contain the PMA-standard `docs/changelog.md`; this plan will not create
an unrelated changelog file.

## Proposal

1. Add a `deleteCronJob(jobId)` DELETE wrapper to the existing frontend API
   client and a `useDeleteCronJob()` mutation that invalidates
   `queryKeys.cronJobs()` on success.
2. Reuse the existing Base UI-backed shadcn `AlertDialog` on `CronPage`.
   Active cards and the active detail header will show a destructive trash
   icon button. Clicking it stops card navigation and opens a confirmation
   naming the job. Deleted jobs will not show the control.
3. Keep deletion state at page level so the same confirmation flow serves card
   and detail actions. On success, close the dialog and leave the existing
   query refresh to move the row into the deleted-jobs section; if the detail
   job was deleted, return to the list.
4. Change default-job seeding to treat any historical row with the same name,
   including a soft-deleted tombstone, as evidence that the default has already
   been created. This prevents deleted built-ins from returning after restart.
5. Add English and Chinese i18n strings for delete, confirmation, and pending
   state.
6. Follow TDD during implementation: first add focused backend coverage for
   soft deletion and default-job tombstones, frontend API coverage for the
   DELETE request, and a Cron page interaction test for confirmation and
   mutation dispatch; then make the minimum production changes required for
   those tests to pass.

## Risks

- Deletion is intentionally soft: database rows and execution logs remain and
  are visible in the deleted-jobs section. This matches the existing API and
  avoids a migration or cascading data loss.
- Treating a deleted built-in row as a tombstone means the job stays absent
  until it is recreated manually. There is currently no restore endpoint; a
  user can create a new job with the same name because uniqueness applies only
  to active rows.
- The confirmation dialog must preserve keyboard focus and prevent an icon
  click from also opening the job detail card.

## Scope

Expected production changes:

- `apps/api/src/cron/index.ts`
- `apps/frontend/src/lib/kanban-api.ts`
- `apps/frontend/src/hooks/use-kanban.ts`
- `apps/frontend/src/pages/CronPage.tsx`
- `apps/frontend/src/i18n/en.json`
- `apps/frontend/src/i18n/zh.json`

Expected test changes:

- a focused cron API/scheduler test under `apps/api/test/`
- `apps/frontend/src/__tests__/lib/kanban-api.test.ts`
- a focused Cron page test under `apps/frontend/src/__tests__/pages/`

No schema migration or dependency change is required.

## Alternatives

- Hard-delete cron rows and logs: rejected because it destroys execution
  history and conflicts with the existing deleted-jobs UI.
- Add only the frontend button: smaller, but rejected because built-in jobs
  would silently return after restart.
- Use `window.confirm`: simpler but inconsistent with the existing accessible
  destructive-action pattern; the existing `AlertDialog` requires no new
  dependency.

## Annotations

- 2026-08-20 19:55 — Approved by the user with "开始处理".
- 2026-08-20 20:03 — Completed after TDD, full test suites, lint, build, and a
  stack-aware local diff review. The review tightened the confirmation wording
  to avoid implying that an already-running callback is forcibly cancelled.
