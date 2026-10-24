# 20261024-1445-backend-issue-order Order issues by the backend rule only

- **status**: completed
- **createdAt**: 2026-10-24 14:45
- **approvedAt**: 2026-10-24 15:05
- **relatedTask**: 20261024-1445-backend-issue-order

## Context

- `GET /api/projects/:projectId/issues` (`routes/issues/query.ts`) orders by
  `isPinned DESC, statusUpdatedAt DESC, issueNumber DESC`.
- `lib/issue-order.ts` `groupIssuesByStatus()` re-sorts each status group by
  `isPinned`, then `sortOrder ASC`, with `statusUpdatedAt DESC` only as a tiebreaker.
  `create.ts` and `backfillSortOrders()` give every issue a distinct `sortOrder`, so the
  tiebreaker never applies and order is creation order plus manual drags.
- `components/issue-drag/` (dnd-kit): `SortableIssues` opens a sortable gap in the own
  group, `planDropSlot` computes a drop index in another group from the pointer,
  `planDropUpdates` -> `computeDragUpdates` writes `statusId` + `sortOrder` via bulk PATCH.
- `useBulkUpdateIssues` optimistically patches the cached issue with the sent fields.
- Status changes set `statusUpdatedAt` on the server (update, bulk update, engine,
  reconciler, cron close); `sortOrder` is never touched there.

## Proposal

Option B: the kanban board keeps manual `sortOrder` ordering and in-column drag; only
the issue list panel follows the backend order. Frontend only; DB column and API stay.

1. `lib/issue-order.ts`: add `groupIssuesByRecent()` with the backend rule
   (`isPinned DESC, statusUpdatedAt DESC, issueNumber DESC`); the board keeps
   `groupIssuesByStatus()`.
2. `issue-drag/drop.ts` + `IssueDragContext.tsx`: a `sortable` flag (default on). Off,
   cards are not droppables (no in-group gap), the drop slot sits where the card will
   land (index 0 when pinned, after the pinned cards otherwise), and a drop on another
   group sends only `{ id, statusId }`; a drop in the own group does nothing.
3. `IssueListPanel.tsx`: use `groupIssuesByRecent()` and `sortable={false}`.
4. `useBulkUpdateIssues` optimistic update: when `statusId` changes, set
   `statusUpdatedAt` to now so the card lands in place before the refetch.
5. Tests first for the new ordering and drop rules.

## Risks

- The board and the list show different orders within a status (accepted with option B).
- `statusUpdatedAt` changes only on status changes; title edits or follow-ups within
  `review` do not move an issue. That matches the backend rule as requested.
- Existing `sortOrder` values stay in the DB unused; no migration.

## Scope

~5 source files in `apps/frontend` plus 2 test files and docs.

## Alternatives

- Keep drag reorder but move status-changed issues to the column top by rewriting
  `sortOrder` on the server: keeps manual order but has two sources of truth. Rejected
  per the request.
- Also drop `sortOrder` from the issues schema/API: needs a migration and an API
  contract change; can be a follow-up task.

## Annotations

- 2026-10-24: user chose option B (board keeps drag sorting, list follows the backend order).
