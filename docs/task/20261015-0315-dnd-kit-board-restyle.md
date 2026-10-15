# 20261015-0315-dnd-kit-board-restyle Move issue drag to dnd-kit and restyle the kanban board after bks

- **status**: completed
- **priority**: P2
- **owner**: main/issue-menu-20261015
- **createdAt**: 2026-10-15 03:15

## Description

Issue drag in the list panel and on the kanban board uses native HTML5 drag
(pragmatic-drag-and-drop): the browser renders a static, translucent snapshot,
and a 2px line marks the drop place. The user wants the drag to look like the
bks project (`/srv/ai/bks`, `features/issues/issues-board.tsx`,
`features/plot-view/status-drag.tsx`), and the kanban board styled like the bks
board.

Acceptance criteria:

- List rows and kanban cards drag with a lifted copy that follows the pointer
  (DragOverlay); the source stays in place dimmed; rows of the same group/column
  slide apart to open the gap; another group/column shows a dashed slot the
  height of the dragged item; the target group/column gets a ring highlight.
- A click still opens the issue (5px activation distance); the right-click and
  "..." menus keep working.
- Drops persist through the existing bulk update with fractional `sortOrder`;
  a move to `working` still starts execution.
- Kanban board: bks-style column and card surfaces (bkd colored status dots kept), card with
  title, `#n` chip and tags, `(n)` count, "+" only on Todo / Working, dashed
  empty-column placeholder.

## ActiveForm

Moving issue drag to dnd-kit and restyling the kanban board

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261015-0315-dnd-kit-board-restyle.md

- complete: Board and list drag on dnd-kit; board restyled; verified in the browser
