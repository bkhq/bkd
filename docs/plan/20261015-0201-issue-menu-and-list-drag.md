# 20261015-0201-issue-menu-and-list-drag Extend the issue menu, add list drag, tidy kanban column headers

- **status**: completed
- **createdAt**: 2026-10-15 02:01
- **approvedAt**: 2026-10-15 02:10
- **relatedTask**: 20261015-0201-issue-menu-and-list-drag

## Context

- `components/issue-detail/IssueContextMenu.tsx`: `useIssueMenu` builds items
  shared by the "..." dropdown (`IssueContextMenu`) and the right-click menu
  (`IssueRightClickMenu`). Items: pin, rename, duplicate, download, copy link
  (chat header only via `showCopyLink`), delete. Used by `IssueListPanel`
  (`IssueRow`), `KanbanCard`, `ChatArea`.
- Issues have no priority / assignee / due date fields, so of the reference
  menu only status, open-in-new-tab, copy link apply. Status changes go
  through `PATCH .../issues/:id` (`useUpdateIssue`); a move to `working`
  triggers execution server-side, same as a kanban drag.
- `components/kanban/*`: drag via pragmatic-drag-and-drop; `board-store.ts`
  `commitDrag` computes fractional `sortOrder` and the board calls
  `useBulkUpdateIssues`.
- `IssueListPanel.tsx`: groups by status but sorts by pinned, then
  `statusUpdatedAt` desc — ignores `sortOrder`, so a reorder would not stick.
  No drag support. `StatusGroup` / `IssueRow` are also used by
  `ReviewListPanel` (review page).
- `KanbanColumn.tsx`: count in a `Badge`; "+" on every column. The list panel
  already uses `(n)` and limits "+" to `todo` / `working`.

## Proposal

1. Issue menu (`IssueContextMenu.tsx`):
   - "Status" submenu (base-ui `Menu.SubmenuRoot` + radio items) calling
     `useUpdateIssue({ id, statusId })`.
   - "Open in new tab" (`window.open(getIssueUrl(...), '_blank')`).
   - "Copy link" on every surface (drop `showCopyLink`), plus "Copy issue
     number" (`#n`).
   - Order: status / pin / rename / duplicate / download / open in new tab /
     copy link / copy number / delete, grouped with separators.
2. List drag (`IssueListPanel.tsx`):
   - Feed the list from `useBoardStore` grouping (sorted by pinned, then
     `sortOrder`), same as the board; search filter applied on top.
   - Make `IssueRow` a `draggable` + edge drop target, each `StatusGroup` body
     (including collapsed header and the empty hint) a column drop target, and
     register one `monitorForElements` in `IssueListPanel` that reuses the
     board's drop handler. Extract that handler from `KanbanBoard.tsx` into a
     small hook (`useIssueDragMonitor(projectId)`) used by both.
   - `ReviewListPanel` keeps its own non-draggable rendering (drag enabled
     only through a prop).
3. Kanban header (`KanbanColumn.tsx`): `(n)` text instead of `Badge`; "+"
   only for `todo` / `working`.
4. i18n keys in `en.json` / `zh.json` for new menu items.

## Risks

- Sharing `board-store` between board and list: both views use the same
  `isDragging` gate and `syncFromServer`; only one view is mounted at a time,
  so there is no conflict.
- Changing list order from `statusUpdatedAt` to `sortOrder` changes what users
  see in the list; it becomes identical to the board order.
- Dragging into `working` starts execution — intended, matches the board.
- Base-ui submenu inside a ContextMenu: must be verified in the browser.

## Scope

- `apps/frontend/src/components/issue-detail/IssueContextMenu.tsx`
- `apps/frontend/src/components/issue-detail/IssueListPanel.tsx`
- `apps/frontend/src/components/issue-detail/ChatArea.tsx` (drop `showCopyLink`)
- `apps/frontend/src/components/kanban/KanbanBoard.tsx`, `KanbanColumn.tsx`
- new `apps/frontend/src/hooks/use-issue-drag-monitor.ts`
- `apps/frontend/src/i18n/{en,zh}.json`
- tests: `issue-context-menu.test.tsx` (new items, status change),
  board-store / list ordering test

Out of scope: priority, assignee, due date, relations (no backing fields).

## Alternatives

- Keep list sorted by `statusUpdatedAt` and allow only cross-group drag
  (status change, no reorder). Simpler, but the drop position would be
  ignored.

## Implementation Notes

- Instead of a shared `useIssueDragMonitor` hook, the ordering and drop math moved
  into pure functions in `lib/issue-order.ts` (`groupIssuesByStatus`,
  `resolveDropPosition`, `computeDragUpdates`). `board-store` and the kanban drop
  handler use them; the list panel registers its own monitor with `list-row` /
  `list-group` drag types and relies on the bulk update's optimistic cache write,
  so it does not share `board-store` state.
- `resolveDropPosition` finds the target card by id, which also fixes the kanban
  board dropping at the wrong index while a search filter is active.
- Menu popups get `min-w-40` so the longer labels do not wrap; kanban column
  headers get a fixed `h-11` so columns without "+" keep the same height.
