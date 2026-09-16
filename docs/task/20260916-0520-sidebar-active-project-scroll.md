# 20260916-0520-sidebar-active-project-scroll Keep the active project visible in the sidebar rail

- **status**: completed
- **priority**: P2
- **owner**: claude/session-main
- **createdAt**: 2026-09-16 05:20

## Description

`AppSidebar` renders the project rail in a scroll container whose scrollbar is
hidden (`scrollbarWidth: 'none'`). When the active project sits outside the
visible range — many projects, or a project far down the list — nothing on
screen indicates which project is selected, and the user has to scroll the rail
by hand to find the highlight. The rail never scrolls the active entry into
view, on mount or when the active project changes.

Acceptance criteria:

- Opening any page with a sidebar scrolls the rail so the active project is centered.
- Switching projects re-centers the rail on the newly active entry.
- A rail with no active project (e.g. the review page passes `activeProjectId=""`) does not scroll.
- Regression test covers mount and active-project change.

## ActiveForm

Centering the sidebar rail on the active project

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- `MobileSidebar` has the same pattern in its drawer list; out of scope unless requested.

- complete: Active project button scrolls itself into the center of the rail
