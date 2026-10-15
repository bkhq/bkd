import type { CollisionDetection, DragMoveEvent } from '@dnd-kit/core'
import { closestCenter, pointerWithin, rectIntersection } from '@dnd-kit/core'
import type { DragUpdate, GroupedIssues } from '@/lib/issue-order'
import { computeDragUpdates } from '@/lib/issue-order'
import { STATUS_MAP } from '@/lib/statuses'
import type { Issue } from '@/types/kanban'

/* Pure drop rules for dragging issues between status groups, shared by the kanban
   board and the list panel. Droppable ids are either a status id (the group) or an
   issue id (a card in it). */

function isStatus(id: string): boolean {
  return STATUS_MAP.has(id)
}

function columnOf(columns: GroupedIssues, id: string): string | undefined {
  return Object.keys(columns).find(status => columns[status]!.some(issue => issue.id === id))
}

/**
 * Resolves a drop by the pointer rather than by corner distance: a column's droppable
 * is as tall as its cards, so nearest corners let a short neighbour win over the
 * column the card hovers on. Inside a column that holds cards the nearest card wins,
 * which keeps in-column sorting intact.
 */
export function boardCollision(columns: GroupedIssues): CollisionDetection {
  return (args) => {
    const hit = pointerWithin(args)[0] ?? rectIntersection(args)[0]
    if (hit === undefined) return []
    const id = String(hit.id)
    if (!isStatus(id)) return [hit]
    const cardIds = new Set((columns[id] ?? []).map(issue => issue.id))
    const cards = args.droppableContainers.filter(container => cardIds.has(String(container.id)))
    return cards.length === 0 ? [hit] : closestCenter({ ...args, droppableContainers: cards })
  }
}

export interface DropPlan {
  cardId: string
  toColumnId: string
  /** Insertion index into the destination column as it was before the card left it. */
  toIndex: number
}

/**
 * The drag-end decision: where the card lands. `index` is the drop slot shown in
 * another column; inside its own column the sortable gap decides. `null` means the
 * drop changed nothing.
 */
export function planDrop({ activeId, overId, index, columns }: {
  activeId: string
  overId: string
  index?: number
  columns: GroupedIssues
}): DropPlan | null {
  const from = columnOf(columns, activeId)
  const to = isStatus(overId) ? overId : columnOf(columns, overId)
  if (from === undefined || to === undefined) return null
  const ids = (columns[to] ?? []).map(issue => issue.id)

  if (to === from) {
    const oldIndex = ids.indexOf(activeId)
    // Dropping on the column body rather than on a card means "put it last".
    const newIndex = isStatus(overId) ? ids.length - 1 : ids.indexOf(overId)
    if (oldIndex === newIndex) return null
    // The sortable gap gives the final index; moving down inserts after the target.
    return { cardId: activeId, toColumnId: to, toIndex: newIndex > oldIndex ? newIndex + 1 : newIndex }
  }

  const at = index ?? (isStatus(overId) ? ids.length : ids.indexOf(overId))
  return { cardId: activeId, toColumnId: to, toIndex: at }
}

/** The open slot a card dragged in from another column would fill. */
export interface DropSlot {
  status: string
  index: number
  /** The dragged item's height, so the slot reserves the room it will take. */
  height: number | null
}

/**
 * Where a dragged card would land in another column, from one drag move. dnd-kit only
 * reports a new `over` when the target changes, so the half of the card the pointer
 * sits on is read on every move. The card's own column opens a sortable gap instead.
 */
export function planDropSlot({ event: { active, over }, columns, current }: {
  event: Pick<DragMoveEvent, 'active' | 'over'>
  columns: GroupedIssues
  current: DropSlot | null
}): DropSlot | null {
  const activeId = String(active.id)
  const from = columnOf(columns, activeId)
  const overId = over ? String(over.id) : null
  const target = overId === null ? undefined : isStatus(overId) ? overId : columnOf(columns, overId)
  if (over === null || overId === null || target === undefined || from === undefined || target === from) return null
  const column = columns[target] ?? []
  let index: number
  if (isStatus(overId)) {
    // Over the column itself is mostly over the open slot, which is no droppable.
    index = current?.status === target ? current.index : column.length
  } else {
    const rect = active.rect.current.translated
    const below = rect !== null && rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2
    index = column.findIndex(issue => issue.id === overId) + (below ? 1 : 0)
  }
  const height = active.rect.current.initial?.height ?? null
  return current?.status === target && current.index === index && current.height === height
    ? current
    : { status: target, index, height }
}

/** Maps an insertion index in a search-filtered column onto the full column. */
export function toFullIndex(full: Issue[], visible: Issue[], index: number): number {
  const at = visible[index]
  if (at) return full.findIndex(issue => issue.id === at.id)
  const last = visible.at(-1)
  return last ? full.findIndex(issue => issue.id === last.id) + 1 : full.length
}

/**
 * The whole drag-end decision: the sortOrder updates a drop persists. Positions are
 * read from the visible columns and mapped onto the full ones; the slot only counts
 * when it sits in the column the card was dropped on.
 */
export function planDropUpdates({ activeId, overId, slot, columns, visibleColumns }: {
  activeId: string
  overId: string
  slot: DropSlot | null
  columns: GroupedIssues
  visibleColumns: GroupedIssues
}): DragUpdate[] {
  const overStatus = isStatus(overId) ? overId : columnOf(visibleColumns, overId)
  const plan = planDrop({
    activeId,
    overId,
    ...(slot !== null && slot.status === overStatus ? { index: slot.index } : {}),
    columns: visibleColumns,
  })
  if (!plan) return []
  const toIndex = toFullIndex(columns[plan.toColumnId] ?? [], visibleColumns[plan.toColumnId] ?? [], plan.toIndex)
  return computeDragUpdates(columns, { ...plan, toIndex })
}
