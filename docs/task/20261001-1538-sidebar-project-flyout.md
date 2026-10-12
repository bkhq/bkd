# 20261001-1538-sidebar-project-flyout Show the full project list on sidebar hover

- **status**: completed
- **priority**: P2
- **owner**: claude/session-main
- **createdAt**: 2026-10-01 15:38

## Description

The desktop rail (`AppSidebar`) is a fixed `w-14` icon strip; each project is a
`w-9 h-9` square showing the two-letter abbreviation from
`getProjectInitials()`. Abbreviations collide and are hard to read, and the
existing per-button tooltip only reveals one name at a time, so there is no way
to scan the project list.

Replace the per-button tooltip with a flyout: hovering the project area opens a
panel at the right edge of the rail listing every project as abbreviation plus
full name, with the active one highlighted and each row clickable.

An expand-the-whole-rail variant was rejected: the lower half of the rail holds
the connection indicator, terminal, notes, view-mode select, global pages and
settings, which would all have to become labelled rows.

Acceptance criteria:

- Hovering the project area opens a flyout listing every project's full name;
  leaving the area closes it.
- Moving the pointer from the rail into the flyout keeps it open (shared hover
  region plus a short close delay) — it must not flicker shut while crossing.
- Clicking a flyout row navigates to that project.
- The active project is marked in the flyout.
- The flyout scrolls instead of overflowing the viewport when projects are many.
- The per-button tooltip is gone (it would double up with the flyout).
- Clicking a rail button still navigates directly; no change to the rest of the
  rail or to `MobileSidebar`.
- Regression tests cover opening on hover, the full names, and click-to-navigate.

## ActiveForm

Showing the full project list on sidebar hover

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Out of scope unless asked: grouping or filtering the flyout by project tag,
  and changing the abbreviation algorithm itself.

- complete: `bun run test:frontend` 134/134 (6 new flyout cases), `bun run lint`
  (0 errors, 2 pre-existing warnings), `bun run typecheck`, `bun run build`.
  Hover behaviour itself is only exercised through jsdom `fireEvent`; the visual
  placement against a real viewport is unverified in this container.
