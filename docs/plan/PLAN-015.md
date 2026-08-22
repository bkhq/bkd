# PLAN-015 Add one-click cron history cleanup

- **status**: draft
- **createdAt**: 2026-08-21 01:30
- **approvedAt**: (pending)
- **relatedTask**: CRON-003

## Context

Cron jobs use soft deletion (`cron_jobs.is_deleted=1`) so their execution logs
remain readable. `cron_job_logs.job_id` has a foreign key to `cron_jobs.id`
without a cascade rule, so logs must be deleted before a cron row can be
hard-deleted.

The existing scheduled `log-cleanup` action is retention-oriented: it purges
logs for soft-deleted jobs and keeps the latest 1,000 logs for active jobs. It
does not hard-delete cron jobs and it intentionally does not provide an
operator-triggered full-history cleanup.

CRON-002 introduced an important interaction: `ensureDefaultJobs()` treats a
soft-deleted built-in row as a tombstone. Hard-deleting that row would remove
the tombstone and cause the default job to be recreated on restart. The
existing `app_settings` table can persist suppressed default action names as a
JSON array without a schema migration.

The frontend already has a Base UI-backed shadcn `AlertDialog`, a global Sonner
toaster, the cron query key hierarchy, and the CRON-002 page-level destructive
confirmation pattern. These can be reused without a new dependency or UI
primitive.

The repository still has no `docs/changelog.md`. The working tree contains the
completed but uncommitted CRON-002 changes; CRON-003 will build surgically on
those files and preserve them.

## Proposal

1. Add an OpenAPI-described `DELETE /api/cron/history` endpoint and register it
   before the existing `DELETE /api/cron/{jobId}` route so the static path is
   never interpreted as a job ID.
2. In one SQLite transaction:
   - load all soft-deleted cron jobs;
   - merge deleted built-in default names into a JSON array stored under a
     dedicated `app_settings` key;
   - delete every log associated with a soft-deleted job, including any stale
     or in-flight `running` row required to release the foreign key;
   - delete completed logs (`finished_at IS NOT NULL`) for active jobs while
     retaining their `running` logs;
   - hard-delete the soft-deleted cron job rows;
   - return `{ jobsDeleted, logsDeleted }`.
3. Update default-job startup seeding to skip names recorded in the persistent
   suppression setting as well as names represented by existing rows. Run
   `VACUUM` after a non-empty cleanup so the one-click operation also reclaims
   SQLite pages, matching the existing settings cleanup behavior.
4. Add a typed API client method and React Query mutation. On success,
   invalidate the cron query hierarchy so job lists, last-run summaries, and
   cached log queries refresh.
5. Add a labeled cleanup-history button to the cron page header. Reuse
   `AlertDialog` for irreversible confirmation, disable duplicate submits,
   expose API errors, return from a stale detail view after success, and show a
   localized success toast containing both counts.
6. Follow TDD: first add failing API tests for deletion scope, running-log
   preservation, idempotency, and built-in suppression; then add frontend API,
   hook, and page interaction tests before implementing the minimum code.

## Risks

- Cleanup is irreversible: deleted cron definitions and completed execution
  logs cannot be restored. The confirmation copy must state this clearly.
- A deleted cron may still have an already-running callback. Its log row must
  be removed with the deleted parent, and a later completion update becomes a
  harmless no-op. Active cron jobs keep their running log rows.
- `VACUUM` is synchronous and can briefly block SQLite access after a large
  cleanup. It only runs when at least one row was deleted and is initiated by
  an explicit operator action.
- The persistent suppression setting must be written in the same transaction
  as hard deletion; otherwise a failure could allow cleaned built-in defaults
  to return on restart.

## Scope

Expected production changes:

- `apps/api/src/cron/index.ts`
- `apps/api/src/routes/cron.ts`
- `apps/api/src/openapi/routes.ts`
- `apps/frontend/src/lib/kanban-api.ts`
- `apps/frontend/src/hooks/use-kanban.ts`
- `apps/frontend/src/pages/CronPage.tsx`
- `apps/frontend/src/i18n/en.json`
- `apps/frontend/src/i18n/zh.json`

Expected test changes:

- `apps/api/test/api-cron.test.ts`
- `apps/frontend/src/__tests__/lib/kanban-api.test.ts`
- `apps/frontend/src/__tests__/hooks/use-cleanup-cron-history.test.tsx`
- `apps/frontend/src/__tests__/pages/cron-page.test.tsx`

No dependency or database schema migration is required.

## Alternatives

- Delete every cron log regardless of status: rejected because removing the
  active job's `running` log makes current execution state disappear.
- Preserve deleted built-in rows as tombstones: rejected because the cleanup
  would visibly leave some deleted cron jobs behind.
- Extend the generic settings cleanup target: possible, but a cron-owned API
  and button keep the operation discoverable and avoid coupling the cron page
  to unrelated issue/worktree cleanup payloads.
- Skip `VACUUM`: faster and less blocking, but the SQLite file would retain its
  size even after a user explicitly requests history cleanup.

## Annotations

(pending user review)
