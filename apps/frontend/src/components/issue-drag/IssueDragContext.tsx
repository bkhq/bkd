import type { DragEndEvent, DragMoveEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { createContext, Fragment, use, useMemo, useState } from 'react'
import { useBulkUpdateIssues } from '@/hooks/use-kanban'
import type { GroupedIssues } from '@/lib/issue-order'
import { STATUS_MAP } from '@/lib/statuses'
import type { Issue } from '@/types/kanban'
import type { DropSlot } from './drop'
import { boardCollision, planDropSlot, planDropUpdates } from './drop'

/* One drag context around a set of status groups (kanban columns or list groups):
   cards drag, groups take drops, the source stays dimmed while a lifted copy follows
   the pointer, the own group opens a sortable gap and another group a dashed slot. */

interface IssueDragState {
  overStatus: string | null
  slot: DropSlot | null
}

const IssueDragStateContext = createContext<IssueDragState>({ overStatus: null, slot: null })

export function IssueDragProvider({ projectId, columns, visibleColumns, renderOverlay, children }: {
  projectId: string
  /** Every group's issues in display order, unfiltered: what a drop is persisted against. */
  columns: GroupedIssues
  /** The issues on screen, e.g. after a search filter; drop positions are read from these. */
  visibleColumns: GroupedIssues
  /** The lifted copy that follows the pointer. */
  renderOverlay: (issue: Issue) => ReactNode
  children: ReactNode
}) {
  const bulkUpdate = useBulkUpdateIssues(projectId)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<string | null>(null)
  const [slot, setSlot] = useState<DropSlot | null>(null)
  // The activation distance keeps a click on a card opening the issue.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const collisionDetection = useMemo(() => boardCollision(visibleColumns), [visibleColumns])
  const issuesById = useMemo(
    () => new Map(Object.values(visibleColumns).flat().map(issue => [issue.id, issue] as const)),
    [visibleColumns],
  )

  function statusOf(id: string): string | null {
    return STATUS_MAP.has(id) ? id : issuesById.get(id)?.statusId ?? null
  }

  function reset() {
    setActiveId(null)
    setOverStatus(null)
    setSlot(null)
  }

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id))
    setOverStatus(statusOf(String(active.id)))
    setSlot(null)
  }

  function handleDragMove(event: DragMoveEvent) {
    setSlot(current => planDropSlot({ event, columns: visibleColumns, current }))
  }

  function handleDragOver({ over }: DragOverEvent) {
    setOverStatus(over ? statusOf(String(over.id)) : null)
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    reset()
    if (!over) return
    const updates = planDropUpdates({ activeId: String(active.id), overId: String(over.id), slot, columns, visibleColumns })
    if (updates.length > 0) bulkUpdate.mutate(updates)
  }

  const activeIssue = activeId ? issuesById.get(activeId) : undefined
  const state = useMemo(() => ({ overStatus, slot }), [overStatus, slot])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      // The slot moves cards while the drag runs, so droppables are re-measured throughout.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <IssueDragStateContext value={state}>{children}</IssueDragStateContext>
      <DragOverlay dropAnimation={null}>
        {activeIssue ? <div className="cursor-grabbing">{renderOverlay(activeIssue)}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

/** A status group that takes drops anywhere on it, even when collapsed or empty. */
export function useIssueDropGroup(status: string) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const { overStatus, slot } = use(IssueDragStateContext)
  return {
    setNodeRef,
    isTarget: isOver || overStatus === status,
    slot: slot?.status === status ? slot : null,
  }
}

/** The draggable cards of one group, with the drop slot opened between them. */
export function SortableIssues({ status, items, slotClassName, children }: {
  status: string
  items: Issue[]
  slotClassName?: string
  children: (issue: Issue) => ReactNode
}) {
  const { slot } = use(IssueDragStateContext)
  const ownSlot = slot?.status === status ? slot : null
  return (
    <SortableContext items={items.map(issue => issue.id)} strategy={verticalListSortingStrategy}>
      {items.map((issue, index) => (
        <Fragment key={issue.id}>
          {ownSlot?.index === index ? <DropSlotMarker height={ownSlot.height} className={slotClassName} /> : null}
          <SortableIssue id={issue.id}>{children(issue)}</SortableIssue>
        </Fragment>
      ))}
      {ownSlot !== null && ownSlot.index >= items.length ? <DropSlotMarker height={ownSlot.height} className={slotClassName} /> : null}
    </SortableContext>
  )
}

/* Reserves the dragged card's height where it will land. A thin line would sit right
   under the lifted copy, which floats over the pointer. */
function DropSlotMarker({ height, className }: { height: number | null, className?: string }) {
  return (
    <div
      data-testid="issue-drop-slot"
      aria-hidden="true"
      style={height === null ? undefined : { height }}
      className={cn('shrink-0 rounded-md border border-dashed border-primary/50 bg-primary/5', className)}
    />
  )
}

function SortableIssue({ id, children }: { id: string, children: ReactNode }) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // The lifted copy lives in the DragOverlay; the in-flow card is the placeholder.
      className={cn(isDragging && 'opacity-40')}
      {...listeners}
    >
      {children}
    </div>
  )
}
