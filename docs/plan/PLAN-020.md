# PLAN-020 Stop serving soft-deleted cron jobs over the API

- **status**: completed
- **createdAt**: 2026-09-08 00:00
- **approvedAt**: 2026-09-08
- **relatedTask**: CRON-004

## Context

`apps/api/src/routes/cron.ts` lists jobs in two branches. Without `limit`/
`cursor` it selects every row and filters in memory: `deleted === 'only'` keeps
soft-deleted rows, `deleted === 'false'` keeps active rows, and **anything else
— including the parameter being absent — returns all rows**. The paginated
branch is stricter: a missing `deleted` is treated as `'false'`, so the two
shapes disagree on the default.

`apps/frontend/src/lib/kanban-api.ts:623` calls `/api/cron` with no parameters,
so the cron page receives soft-deleted jobs. `CronPage.tsx:466-467` splits them
into `activeJobs` / `deletedJobs`, shows a `+N` badge next to the job count and
renders a collapsible deleted section (`cron.deletedJobs`, `isDeletedView`
styling, `job.isDeleted` guards at lines 325-337).

Every other per-job route resolves through `findJob()`, which already filters
`is_deleted = 0` — delete, trigger, pause and resume all 404 on a deleted job.
`GET /api/cron/:jobId/logs` is the one exception: it looks the job up by id with
no deletion filter, on purpose (CRON-002). That retention is nominal anyway —
`cron/actions/builtins/log-cleanup.ts:20` purges all logs of a soft-deleted job
on its next run.

`serializeJob()` (`apps/api/src/cron/serialize.ts`) exposes `isDeleted`, mirrored
in the frontend-only `CronJob` interface. `CronJobSchema` lives in
`apps/api/src/openapi/schemas.ts`; the `deleted` query enum is declared in
`openapi/routes.ts:718`.

Docs: `skills/bkd/references/rest-api.md:218` lists `deleted=false|true|only` as
a cron list parameter. No `docs/api/cron.md` exists and `docs/architecture.md`
does not mention the parameter.

## Proposal

1. **API list route** (`routes/cron.ts`) — drop the `deleted` branching. Both
   the unpaginated and the paginated query filter `eq(cronJobs.isDeleted, 0)`
   unconditionally.
2. **Logs route** (`routes/cron.ts`) — resolve the job through `findJob(jobId)`
   so a soft-deleted job's logs 404 like its other routes.
3. **OpenAPI** (`openapi/routes.ts`) — remove `deleted` from the `listCronJobs`
   query schema. `CronJobSchema` never declared `isDeleted`, so it stays as is.
4. **Serializer** (`cron/serialize.ts`) — remove `isDeleted` from
   `SerializedCronJob` and from the returned object.
5. **Frontend** — remove `isDeleted` from the `CronJob` interface
   (`lib/kanban-api.ts`); in `CronPage.tsx` drop `showDeleted`, the
   `activeJobs`/`deletedJobs` split (render `jobs` directly), the `+N` badge
   suffix, the deleted section, the `isDeletedView` prop and every
   `job.isDeleted` guard, plus imports left unused by the removal.
6. **i18n** — delete the `cron.deletedJobs` key from `en.json` and `zh.json`.
7. **Docs** — drop the `deleted=false|true|only` line from
   `skills/bkd/references/rest-api.md`.

## Test Plan

RED first:

- `apps/api/test/api-cron.test.ts` — `GET /api/cron` omits a soft-deleted job in
  the unpaginated shape and in the `?limit=` shape; `GET /api/cron/:jobId/logs`
  returns 404 for a soft-deleted job.
- `apps/frontend/src/__tests__/pages/cron-page.test.tsx` — replace the obsolete
  "does not offer deletion for an already deleted cron job" case (it sets
  `job.isDeleted = true`, which the API can no longer produce).

Then: `bun run test:api`, `bun run test:frontend`, `bun run lint`, frontend
typecheck and build.

## Risks

- **Breaking API change.** `deleted=only|true` currently lets a client list
  tombstones; afterwards the parameter is stripped by the Zod query schema and
  silently ignored, so such a client sees only active jobs. Deletion can still
  be verified by the job disappearing from the list. The
  installed `bkd` skill under `~/.claude/skills/bkd` documents `?deleted=only`
  as the way to confirm a delete and must be updated separately — it is not part
  of this repository.
- Soft-deleted rows stay in the database; only the API surface changes.

## Outcome

Implemented as proposed. The `cron.deleted` badge label became unused alongside
`cron.deletedJobs` and both keys were removed from `en.json` / `zh.json`. With
`isDeletedView` gone, `CronJobList.onDeleteJob` is now a required prop. The
frontend case "does not offer deletion for an already deleted cron job" was
dropped rather than rewritten — the API can no longer return such a job.
