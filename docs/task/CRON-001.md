# CRON-001 Expose manual pause/resume for cron jobs in the UI

- **status**: completed
- **priority**: P2
- **owner**: roy
- **createdAt**: 2026-05-18 00:00

## Description

The backend already implements manual pause/resume:

- `POST /api/cron/:jobId/pause` (`apps/api/src/routes/cron.ts:269`) — sets
  `cronJobs.enabled=false` + `baker.pause()`.
- `POST /api/cron/:jobId/resume` (`apps/api/src/routes/cron.ts:291`) — sets
  `cronJobs.enabled=true` + `syncJob()`.

Both routes are registered in `openapi/routes.ts` (`pauseCronJob`,
`resumeCronJob`). The gap is purely frontend: `kanban-api.ts` only exposes
`getCronJobs`/`getCronJobLogs`, and `CronPage.tsx` is entirely read-only. There
is no UI affordance to pause an active job or resume a paused one.

Side effect worth noting: the executor auto-pauses a job after 3 consecutive
failures (`apps/api/src/cron/executor.ts:94`, sets `enabled=false`). Today an
auto-paused job has **no UI path to recover** — adding a resume button fixes
that too.

Scope (minimal, per request):

- API client (`apps/frontend/src/lib/kanban-api.ts`): add `pauseCronJob(jobId)`
  and `resumeCronJob(jobId)` POST methods.
- Hooks (`apps/frontend/src/hooks/use-kanban.ts`): add `usePauseCronJob` /
  `useResumeCronJob` mutations that invalidate `queryKeys.cronJobs()`.
- UI (`apps/frontend/src/pages/CronPage.tsx`): a pause/resume toggle button on
  each active job card and in the log-detail header. Button reflects
  `job.enabled` (paused ⇒ show Resume; enabled ⇒ show Pause). Stop card click
  propagation. Deleted jobs get no button.
- i18n: add `cron.pause` / `cron.resume` keys to `en.json` and `zh.json`.

Out of scope: trigger and delete buttons (not requested).

Acceptance criteria:

- An enabled job shows a Pause control; clicking it pauses the job and the card
  flips to Resume + `disabled` status badge, without selecting the job.
- A paused (manually or auto-paused) job shows a Resume control; clicking it
  resumes scheduling and the next-run time reappears.
- Deleted jobs show no pause/resume control.
- `bun --filter @bkd/frontend lint` and frontend typecheck pass.

## ActiveForm

Wiring frontend pause/resume controls onto the existing cron backend routes.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Backend unchanged — no schema migration, no new endpoints, no new dependencies.
