# PLAN-005 Remove whiteboard / mindmap feature

- **status**: completed
- **createdAt**: 2026-05-09
- **approvedAt**: 2026-05-09
- **relatedTask**: WB-005

## Context

The whiteboard feature (PLAN-001 + PLAN-002, tasks WB-001..WB-004) is
being retired. It comprised:

- Backend: `whiteboard_nodes` table, 7 REST routes under
  `/api/projects/:projectId/whiteboard/*`, system/turn prompt builder,
  hidden-issue mechanism (`issues.is_hidden`) for whiteboard-bound AI
  sessions.
- Frontend: `/projects/:id/whiteboard` route, `WhiteboardPage`,
  `WhiteboardCanvas` (xyflow + elkjs), `MindmapNode`, `AskAIPopover`,
  `GenerateIssuesDialog`, layout helper, hooks, header buttons in
  Kanban + IssueList.
- Shared: `WhiteboardNode` interface, `Issue.isHidden` field.
- Migrations: 0016 (table create), 0017 (`is_hidden` add + back-fill),
  0018 (reset whiteboard sessions).

User chose option B: bound whiteboard issues are soft-deleted in the
removal migration so that dropping `is_hidden` does not surface them
in the regular issue list.

## Decisions

- **Soft-delete bound issues** (option B): in `0019_drop_whiteboard.sql`
  set `is_deleted=1` on every issue id referenced by
  `whiteboard_nodes.bound_issue_id` before dropping the table, then
  drop the column. Other heuristic clean-up (matching on tag /
  `[Whiteboard]` title prefix) is intentionally skipped — `bound_issue_id`
  is the authoritative link.
- **Drop the `is_hidden` column** rather than leaving it dormant. Bun
  ships SQLite ≥ 3.45, which supports `ALTER TABLE ... DROP COLUMN`.
- **Drop the `whiteboard_nodes` table** rather than soft-delete its
  contents — table removal is idempotent and matches the feature
  removal intent.
- **Close (not delete) WB-001..WB-004 + PLAN-001 + PLAN-002**: per
  PMA index rule "only update the checkbox marker; never delete the
  line." All move to `[~]`.

## Implementation order

1. Create WB-005 task and PLAN-005 (this file); update indexes.
2. Delete frontend whiteboard files (page + components + hooks + lib +
   tests).
3. Update frontend wiring: `main.tsx`, `KanbanHeader.tsx`,
   `IssueListPanel.tsx`, `kanban-api.ts`, `types/kanban.ts`, i18n.
4. Delete backend whiteboard route files.
5. Update backend wiring: `routes/api.ts`, `app.ts`,
   `openapi/routes.ts`, `openapi/schemas.ts`, `db/schema.ts`,
   `routes/issues/query.ts`, `routes/issues/_shared.ts`.
6. Update `packages/shared/src/index.ts`.
7. Add `apps/api/drizzle/0019_drop_whiteboard.sql` (+ journal entry).
8. Run `bun run lint`, typecheck (api+frontend), `bun run test`.

## Risk

- Migration 0019 uses `ALTER TABLE DROP COLUMN`; older SQLite would
  fail. Bun ≥ 1.0 ships SQLite ≥ 3.42, well above the 3.35 threshold.
- Soft-deleting bound issues is irreversible for users via UI (already
  the case for any soft delete). Hard delete is not used.
- No external code consumes `WhiteboardNode` or whiteboard endpoints
  beyond the BKD frontend.

## Verification

See WB-005 task verification section.
