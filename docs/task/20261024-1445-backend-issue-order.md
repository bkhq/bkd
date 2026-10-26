# 20261024-1445-backend-issue-order Order issues by the backend rule only, drop in-column drag sorting

- **status**: completed
- **priority**: P2
- **owner**: main
- **createdAt**: 2026-10-24 14:45

## Description

The kanban board and the issue list re-sort issues by `sortOrder` (manual drag order),
with `statusUpdatedAt` only as a tiebreaker, so a recently changed issue does not move
to the top. The backend already orders by `isPinned DESC, statusUpdatedAt DESC,
issueNumber DESC`; that rule becomes the only source of order.

Acceptance criteria (option B, chosen 2026-10-24):

- The kanban board keeps manual `sortOrder` ordering and in-column drag sorting.
- The issue list panel shows issues in the backend order.
- In the list, dragging within a group does nothing; dragging to another group changes
  the status only, and the drop slot shows where the card will land.

## ActiveForm

Ordering issues by the backend rule

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261024-1445-backend-issue-order.md

- complete: bun run check passed (lint, typecheck, 986 API + 390 frontend tests, build).
