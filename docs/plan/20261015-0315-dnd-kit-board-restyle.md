# 20261015-0315-dnd-kit-board-restyle Move issue drag to dnd-kit and restyle the kanban board after bks

- **status**: completed
- **createdAt**: 2026-10-15 03:15
- **approvedAt**: 2026-10-15 03:25
- **relatedTask**: 20261015-0315-dnd-kit-board-restyle

## Context

- bkd drags issues with `@atlaskit/pragmatic-drag-and-drop` (native HTML5 DnD)
  in `KanbanBoard/KanbanColumn/KanbanCard` and `IssueListPanel`. Native drag
  images are static bitmaps the browser fades; a custom preview
  (`setCustomNativeDragPreview`) is still a snapshot and cannot animate the list.
  `HomePage.tsx` also uses pragmatic (project ordering) and is out of scope.
- bks uses `@dnd-kit/core` + `@dnd-kit/sortable` (pointer events): a
  `DragOverlay` lifted copy (`shadow-lg ring-foreground/20`), the source dimmed
  to `opacity-40`, `verticalListSortingStrategy` opening the gap in the own
  column, a dashed `DropSlotMarker` with the dragged height in another column,
  a pointer-first collision rule (`boardCollision`), and a column ring highlight.
- bks board look: columns `w-72 rounded-lg bg-secondary/30`, header = status
  glyph + label + `(n)`, card = `rounded-md bg-background p-3 ring-1
  ring-border/60`, status glyph + title (done struck through) + key chip.
- bkd ordering math already lives in `lib/issue-order.ts`
  (`groupIssuesByStatus`, `computeDragUpdates`), persisted by
  `useBulkUpdateIssues` with an optimistic cache write.

## Proposal

1. Add `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`,
   `@dnd-kit/utilities@^3.2.2` (latest, same as bks) to `apps/frontend`.
2. `components/issue-drag/` (new, shared by board and list):
   - `drop.ts`: pure `boardCollision`, `planDrop` (target status + insertion
     index), `planDropSlot` — ported from bks `status-drop.ts`, typed for bkd
     `Issue` and reduced to the always-reorderable case.
   - `IssueDragContext.tsx`: `DndContext` + `PointerSensor` (distance 5) +
     `DragOverlay`; owns active / over-status / slot state; on drop calls
     `computeDragUpdates` and `useBulkUpdateIssues`. Exposes
     `useIssueDropGroup(status)` (droppable + highlight + slot) and a
     `SortableIssue` wrapper (dim + transform) via context.
   - `DropSlot` dashed marker.
3. Status icons stay bkd's colored dots (user decision: do not port the bks
   status glyphs).
4. Kanban restyle (`KanbanBoard/Column/Card`): drop pragmatic + `board-store`
   drag state; bks column/card surfaces; card keeps pin, `#n` chip, tags,
   "..." button, and gains the right-click menu; overlay renders the same
   surface lifted.
5. List panel: replace pragmatic rows/groups/monitor and the custom native
   preview with the shared context; overlay = the row in a lifted
   `rounded-md bg-background shadow-md ring-1 ring-border` shell.
6. `board-store.ts`: removed if nothing else reads it after the move (the board
   then groups with `groupIssuesByStatus` directly and relies on the bulk
   update's optimistic cache).

## Risks

- PointerSensor + 5px distance: click-to-open and the menus must still work;
  the "..." button stops pointerdown propagation already.
- Touch: dnd-kit pointer sensor makes cards draggable on touch where native DnD
  did nothing; long-press scroll conflicts are possible on mobile kanban.
  Mitigation: keep the 5px distance like bks; revisit if scrolling suffers.
- Two DnD libraries in the bundle until HomePage migrates (~12 kB gz for
  dnd-kit).
- Sortable transforms on the sticky list headers: rows only, headers are not
  sortable items.

## Scope

- `apps/frontend/package.json`, `bun.lock`
- new `apps/frontend/src/components/issue-drag/{drop.ts,IssueDragContext.tsx}`
- `components/kanban/{KanbanBoard,KanbanColumn,KanbanCard}.tsx`
- `components/issue-detail/IssueListPanel.tsx`
- `stores/board-store.ts` (likely removed), `lib/issue-order.ts`
- tests: `drop.ts` unit tests, kanban column/card render tests, existing menu
  tests stay green
- i18n: empty-column label (reuse `issue.emptyStatusHint` if it fits)

Out of scope: HomePage project drag, list group header restyle.

## Alternatives

- Stay on pragmatic and polish the native preview (what was just tried): no
  sliding gap, no live overlay; the user rejected the look.

## Implementation Notes

- `components/issue-drag/drop.ts` (pure rules) and `IssueDragContext.tsx`
  (`IssueDragProvider`, `useIssueDropGroup`, `SortableIssues`) are shared by the
  board and the list. Drop positions are planned on the visible (search-filtered)
  columns and mapped onto the full column with `toFullIndex` before
  `computeDragUpdates` runs.
- `board-store.ts` was removed; the board groups with `groupIssuesByStatus` and
  relies on `useBulkUpdateIssues`' optimistic cache write. `resolveDropPosition`
  and the native custom drag preview from the previous task were removed.
- Kanban cards gained the right-click menu; the "..." button sits outside the
  right-click trigger, as in the list rows.
- pragmatic-drag-and-drop stays for `HomePage.tsx` project ordering.
- Per user feedback the card content keeps the original layout (`#n` and "..." on
  the top row, title, tags); only the surface (ring, overlay shadow) follows bks.
  The column body has `pt-px` so the scroll container does not clip the first
  card's 1px ring.
