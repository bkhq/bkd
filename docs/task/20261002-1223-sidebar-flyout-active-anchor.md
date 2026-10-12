# 20261002-1223-sidebar-flyout-active-anchor Anchor the sidebar flyout to the active project only

- **status**: completed
- **priority**: P2
- **owner**: claude/session-audit-fixes
- **createdAt**: 2026-10-02 12:23

## Description

The project flyout (`AppSidebar`) re-anchors itself to whichever rail icon is
hovered: it tracks the hovered project id and icon position in state, moves as
the pointer travels along the rail, and tints the hovered project's row.

Requested simplification: the flyout only needs to line up with the current
(active) project. Hovering other rail icons must not be synced to the flyout.

Acceptance criteria:

- Hovering any project icon still opens the flyout; leaving closes it after the
  short delay; crossing into the flyout keeps it open.
- The active project's row sits level with the active project's rail icon,
  whichever icon is hovered. Moving between icons does not move the flyout.
- No hovered-row marker (`data-anchor`); only the active row is highlighted.
- With no active project the flyout opens level with the top of the project
  list.
- Tests updated accordingly.

## ActiveForm

Anchoring the sidebar flyout to the active project

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Follow-up to `20261001-1538-sidebar-project-flyout`. Standard tier (component +
its test); approval given in the request.

- complete: Frontend tests 144/144 (3 flyout cases rewritten), lint and typecheck pass. Build not run; placement against a real viewport is unverified (jsdom only).
