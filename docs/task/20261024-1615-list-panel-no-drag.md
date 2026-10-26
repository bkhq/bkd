# 20261024-1615-list-panel-no-drag Disable issue drag in the list panel

- **status**: completed
- **priority**: P2
- **owner**: main
- **createdAt**: 2026-10-24 16:15

## Description

20261024-1445-backend-issue-order kept cross-group drag in the issue list panel, so
scrolling the list (touch or a pointer drag past 5 px) can pick up a row and change its
status. The list follows the backend order and needs no drag at all; the kanban board
keeps drag and sorting.

Acceptance criteria:

- Rows in the list panel are not draggable and groups take no drops.
- The kanban board drag is unchanged.
- The `sortable` switch added for the list is removed with it.

## ActiveForm

Disabling drag in the issue list

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Approved up front by the user (2026-10-24).

- complete: bun run check passed (988 API, 396 frontend tests).
