import type { Issue } from '@bkd/shared'
import { describe, expect, it } from 'vitest'
import { planDrop, planDropSlot, planDropUpdates, planStatusDrop, toFullIndex } from '@/components/issue-drag/drop'
import { groupIssuesByStatus } from '@/lib/issue-order'

function issue(id: string, statusId: string, sortOrder: string, extra: Partial<Issue> = {}): Issue {
  return { id, statusId, sortOrder, isPinned: false, statusUpdatedAt: '2026-10-15T00:00:00Z', ...extra } as Issue
}

const columns = groupIssuesByStatus([
  issue('a', 'todo', 'a0'),
  issue('b', 'todo', 'a1'),
  issue('c', 'todo', 'a2'),
  issue('r', 'review', 'a0'),
])

function rect(top: number, height = 20) {
  return { top, height, left: 0, width: 100, bottom: top + height, right: 100 }
}

describe('planDrop', () => {
  it('reorders down within a column, as an insertion index before removal', () => {
    // a dropped over c lands after c
    expect(planDrop({ activeId: 'a', overId: 'c', columns })).toEqual({ cardId: 'a', toColumnId: 'todo', toIndex: 3 })
  })

  it('reorders up within a column', () => {
    expect(planDrop({ activeId: 'c', overId: 'a', columns })).toEqual({ cardId: 'c', toColumnId: 'todo', toIndex: 0 })
  })

  it('returns null when dropped on itself', () => {
    expect(planDrop({ activeId: 'b', overId: 'b', columns })).toBeNull()
  })

  it('puts a card dropped on its own column body last', () => {
    expect(planDrop({ activeId: 'a', overId: 'todo', columns })).toEqual({ cardId: 'a', toColumnId: 'todo', toIndex: 3 })
  })

  it('moves to another column at the slot index, else at the card or the end', () => {
    expect(planDrop({ activeId: 'b', overId: 'r', index: 1, columns })).toEqual({ cardId: 'b', toColumnId: 'review', toIndex: 1 })
    expect(planDrop({ activeId: 'b', overId: 'r', columns })).toEqual({ cardId: 'b', toColumnId: 'review', toIndex: 0 })
    expect(planDrop({ activeId: 'b', overId: 'done', columns })).toEqual({ cardId: 'b', toColumnId: 'done', toIndex: 0 })
  })

  it('ignores unknown ids', () => {
    expect(planDrop({ activeId: 'x', overId: 'todo', columns })).toBeNull()
  })
})

describe('planDropSlot', () => {
  const active = (top: number) => ({ id: 'b', rect: { current: { translated: rect(top), initial: rect(0, 36) } } })

  it('opens a slot above or below the hovered card of another column', () => {
    const over = { id: 'r', rect: rect(100) }
    expect(planDropSlot({ event: { active: active(95), over } as never, columns, current: null }))
      .toEqual({ status: 'review', index: 0, height: 36 })
    expect(planDropSlot({ event: { active: active(105), over } as never, columns, current: null }))
      .toEqual({ status: 'review', index: 1, height: 36 })
  })

  it('opens no slot in the own column, and keeps the slot over a column body', () => {
    expect(planDropSlot({ event: { active: active(0), over: { id: 'a', rect: rect(0) } } as never, columns, current: null })).toBeNull()
    const current = { status: 'review', index: 0, height: 36 }
    expect(planDropSlot({ event: { active: active(0), over: { id: 'review', rect: rect(0) } } as never, columns, current })).toBe(current)
  })
})

describe('toFullIndex', () => {
  const full = columns.todo!
  it('maps an insertion index in a filtered column onto the full column', () => {
    const visible = [full[0]!, full[2]!] // a, c
    expect(toFullIndex(full, visible, 0)).toBe(0)
    expect(toFullIndex(full, visible, 1)).toBe(2)
    expect(toFullIndex(full, visible, 2)).toBe(3)
    expect(toFullIndex(full, [], 0)).toBe(3)
  })
})

describe('planDropUpdates', () => {
  it('lands at the slot index when the slot is in the drop column', () => {
    const updates = planDropUpdates({ activeId: 'b', overId: 'review', slot: { status: 'review', index: 1, height: 36 }, columns, visibleColumns: columns })
    expect(updates).toHaveLength(1)
    expect(updates[0]!).toMatchObject({ id: 'b', statusId: 'review' })
    // After r ('a0')
    expect(updates[0]!.sortOrder > 'a0').toBe(true)
  })

  it('ignores a stale slot left in another column', () => {
    // The slot says review index 1, but the drop is on todo's own card a: a reorder in todo.
    const updates = planDropUpdates({ activeId: 'c', overId: 'a', slot: { status: 'review', index: 1, height: 36 }, columns, visibleColumns: columns })
    expect(updates).toHaveLength(1)
    expect(updates[0]!).toMatchObject({ id: 'c', statusId: 'todo' })
    // Before a ('a0')
    expect(updates[0]!.sortOrder < 'a0').toBe(true)
  })

  it('maps a drop in a search-filtered column onto the full column', () => {
    // Only a and c are on screen; dropping a over c must land after c, past the hidden b.
    const visibleColumns = { ...columns, todo: [columns.todo![0]!, columns.todo![2]!] }
    const updates = planDropUpdates({ activeId: 'a', overId: 'c', slot: null, columns, visibleColumns })
    expect(updates).toHaveLength(1)
    expect(updates[0]!.sortOrder > 'a2').toBe(true)
  })

  it('returns no updates for a drop that changes nothing', () => {
    expect(planDropUpdates({ activeId: 'b', overId: 'b', slot: null, columns, visibleColumns: columns })).toEqual([])
  })
})

describe('unsortable groups', () => {
  const list = groupIssuesByStatus([
    issue('a', 'todo', 'a0'),
    issue('b', 'todo', 'a1'),
    issue('p', 'review', 'a0', { isPinned: true }),
    issue('r', 'review', 'a1'),
    issue('q', 'done', 'a0', { isPinned: true }),
  ])
  const active = (id: string) => ({ id, rect: { current: { translated: rect(200), initial: rect(0, 36) } } })

  it('puts the slot where the card will land, not under the pointer', () => {
    const over = { id: 'r', rect: rect(100) }
    expect(planDropSlot({ event: { active: active('a'), over } as never, columns: list, current: null, sortable: false }))
      .toEqual({ status: 'review', index: 1, height: 36 })
    expect(planDropSlot({ event: { active: active('q'), over } as never, columns: list, current: null, sortable: false }))
      .toEqual({ status: 'review', index: 0, height: 36 })
  })

  it('changes only the status on a drop in another group', () => {
    expect(planStatusDrop({ activeId: 'a', overId: 'r', columns: list }))
      .toEqual([{ id: 'a', statusId: 'review' }])
  })

  it('does nothing on a drop in the own group', () => {
    expect(planStatusDrop({ activeId: 'a', overId: 'b', columns: list })).toEqual([])
    expect(planStatusDrop({ activeId: 'a', overId: 'todo', columns: list })).toEqual([])
  })
})
