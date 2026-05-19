---
id: PLAN-014
title: Global cockpit skeleton via /review page upgrade
status: completed
created: 2026-05-19
updated: 2026-05-19
tasks: [COCKPIT-001]
---

# PLAN-014 — Global cockpit skeleton via /review page upgrade

## Context

`ReviewPage` already provides the three-column cross-project layout
(sidebar / project-grouped list / chat+diff). It is the lowest-cost
host for a cockpit experience because it already:

- Reuses `useReviewIssues` for cross-project fetch
- Reuses `ChatArea` with `backPath` for deep-link master-detail
- Reuses `ReviewListPanel` for grouped-by-project listing
- Subscribes through the global `EventBus` for SSE updates
- Is wired into the read-status + notifications hooks

The backend endpoint hardcodes `statusId='review'`. Lifting that
constraint plus a stats endpoint is enough to turn the page into a
proper cockpit without introducing a new route.

## Approach

### Backend

1. `routes/issues/review.ts` — accept `?statuses=todo,working,review,done`
   query param. Validate against `STATUS_IDS`. Default = `['review']`
   (back-compat).
2. New `routes/issues/stats.ts` — `GET /api/issues/stats` returns
   `[{projectId, projectName, projectAlias, counts: {todo, working,
   review, done}, total}]` ordered by project sortOrder. Single
   GROUP BY query.
3. Mount at `/api/issues/stats` in `routes/api.ts`.

### Frontend

4. `lib/kanban-api.ts` — add `getIssueStats()`; extend
   `getReviewIssues({ statuses? })`.
5. `hooks/use-kanban.ts` — add `useIssueStats()`; extend
   `useReviewIssues(statuses?)` while keeping a no-arg overload that
   preserves current behavior for the notifications hook.
6. New `components/cockpit/ProjectMatrix.tsx` — pure presentation,
   reads from `useIssueStats`; rows = projects, cols = statuses,
   cells show count + click navigates to that project's kanban with
   status filter (URL param `?status=`).
7. New `components/cockpit/ActivityStream.tsx` — subscribes to
   `eventBus.onIssueActivity`, `onLog`, `onIssueUpdated`,
   `onChangesSummary`. Maintains a capped list (30 items, ULID
   dedup, requestAnimationFrame batching).
8. New `components/cockpit/CockpitDashboard.tsx` — composes matrix
   + activity stream + a "quick create" button that opens the
   shared `CreateIssueDialog` lazily.
9. `pages/ReviewPage.tsx` — render `<CockpitDashboard />` in the
   `!issueId && !hideListPanel` branch.
10. `components/issue-detail/ReviewListPanel.tsx` — status filter
    chips at top (default `working,review`); passes selected
    statuses through to `useReviewIssues`. Hidden when only the
    notifications hook calls the API.
11. i18n keys: `cockpit.title`, `cockpit.matrix.title`,
    `cockpit.activity.title`, `cockpit.empty`, `cockpit.quickCreate`,
    status chip labels.

### TDD order

| # | Test | Implementation |
|---|------|----------------|
| 1 | `apps/api/test/api-issues-review.test.ts` (new) — covers default + `?statuses=` filter | extend `review.ts` |
| 2 | `apps/api/test/api-issues-stats.test.ts` (new) — counts shape + per-project breakdown | new `stats.ts` + mount |
| 3 | `apps/frontend/src/__tests__/components/ProjectMatrix.test.tsx` (new) — renders cells from stats | new `ProjectMatrix.tsx` |
| 4 | `apps/frontend/src/__tests__/components/ActivityStream.test.tsx` (new) — emits via EventBus → list shows item | new `ActivityStream.tsx` |
| 5 | `apps/frontend/src/__tests__/components/CockpitDashboard.test.tsx` (new) — composes children, empty state | new `CockpitDashboard.tsx` |

Then wire into `ReviewPage` and `ReviewListPanel`; visual changes
verified manually.

## Risks

- **Back-compat for `useReviewIssues`** — the notifications hook
  relies on the no-arg call returning only `review`. Default the
  backend filter to `['review']` and only pass `statuses` from the
  cockpit call site.
- **EventBus dedup** — activity stream may receive multiple events
  per tick; cap + rAF batching prevents reflow storms.
- **Stats query cost** — one GROUP BY across `issues` filtered by
  `is_deleted=0`; uses existing `issues_project_id_status_updated_at_idx`.
  Acceptable for current scale.

## Verification

- Backend: `cd apps/api && bun test test/api-issues-review.test.ts test/api-issues-stats.test.ts`
- Frontend: `cd apps/frontend && bunx vitest run src/__tests__/components/{ProjectMatrix,ActivityStream,CockpitDashboard}.test.tsx`
- Lint: `bun run lint`
- Manual smoke: visit `/review` with multiple projects/statuses; verify matrix renders, click navigates, activity stream updates on issue execution.
