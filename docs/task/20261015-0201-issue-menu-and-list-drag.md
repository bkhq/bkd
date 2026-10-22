# 20261015-0201-issue-menu-and-list-drag Extend the issue menu, add list drag, tidy kanban column headers

- **status**: completed
- **priority**: P2
- **owner**: main/issue-menu-20261015
- **createdAt**: 2026-10-15 02:01

## Description

The issue right-click / "..." menu only offers pin, rename, duplicate,
download and delete. The list view (issue list panel) cannot drag issues
between status groups or reorder them. Kanban column headers show the count
in a badge and offer "+" on every column.

Acceptance criteria:

- The issue menu gains a "Status" submenu (radio list of the four statuses),
  "Open in new tab", "Copy link" (on every surface, not only the chat header)
  and "Copy issue number".
- The list panel supports dragging rows between status groups and reordering
  within a group, persisted via the existing bulk update (same semantics as the
  kanban board, including a move to `working` triggering execution).
- The list panel orders rows by `sortOrder`, like the kanban board, so a drop
  stays where it was put.
- Kanban column headers show the count as `(n)` and only `todo` / `working`
  have the "+" button, matching the list panel.

## ActiveForm

Extending the issue menu and adding list drag-and-drop

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261015-0201-issue-menu-and-list-drag.md

- complete: Menu, list drag and kanban header shipped; verified in the browser
