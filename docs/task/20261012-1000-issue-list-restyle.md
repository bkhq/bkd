# 20261012-1000-issue-list-restyle Restyle the issue list panel after the grouped-list reference

- **status**: completed
- **priority**: P2
- **owner**: cd
- **createdAt**: 2026-10-12 10:00

## Description

The user supplied a reference screenshot of a grouped issue list (rounded
group bars with a chevron, status glyph, name and "(count)"; rows with a
status circle, key and title, no separators) and asked for the left list
panel to follow it, with a "+" in the Todo and Working group headers.

Changes:

- Group header: full-width 32px bar on the panel background, chevron that
  rotates when expanded, status dot, name, count in parentheses. Todo and Working
  headers get a "+" that opens the create dialog preset to that status
  (same `openCreateDialog(status.id)` the kanban column uses). The bar stays
  sticky with an opaque base.
- Rows: `#number`, title, pin
  marker and the existing "..." / right-click menu; no bottom border.
- Empty-group hint keeps its text, loses the separator.

Acceptance criteria:

- Todo and Working headers show a "+" that opens the create dialog with the
  matching status; Review and Done do not.
- Headers remain sticky and opaque while scrolling.
- Existing row behaviour (navigate, "..." menu, right-click, pinned first)
  unchanged; `issue-context-menu.test.tsx` still passes.
- Frontend suite, lint, typecheck and build pass.

## ActiveForm

Restyling the issue list panel.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Requested by the user on 2026-10-12 with a reference screenshot; left
  uncommitted with the pending card-border and sticky-header changes.
- The hollow status circle on rows was dropped on review; the group
  header already carries the status colour.
- Rounded bars and the list gutter were tried and reverted on review: the
  list stays flush with the panel edges, matching the search box.

- complete: focused test, frontend suite, lint, typecheck and build passed.

## Verification

- `issue-context-menu.test.tsx`: new group-header case (Todo / Working "+"
  presets the create dialog status; Review / Done have none).
- Frontend suite: 27 files, 170 passed. `bun run lint` 0 errors (2
  pre-existing warnings), `bun run typecheck`, `bun run build` pass.
