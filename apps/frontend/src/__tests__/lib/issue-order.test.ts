import type { Issue } from '@bkd/shared'
import { describe, expect, it } from 'vitest'
import { computeDragUpdates, groupIssuesByStatus } from '@/lib/issue-order'

function issue(id: string, statusId: string, sortOrder: string, extra: Partial<Issue> = {}): Issue {
  return { id, statusId, sortOrder, isPinned: false, statusUpdatedAt: '2026-10-15T00:00:00Z', ...extra } as Issue
}

describe('groupIssuesByStatus', () => {
  it('orders each status by pinned first, then sortOrder', () => {
    const grouped = groupIssuesByStatus([
      issue('c', 'todo', 'a2'),
      issue('a', 'todo', 'a0'),
      issue('p', 'todo', 'a5', { isPinned: true }),
      issue('w', 'working', 'a0'),
    ])
    expect(grouped.todo!.map(i => i.id)).toEqual(['p', 'a', 'c'])
    expect(grouped.working!.map(i => i.id)).toEqual(['w'])
    expect(grouped.done).toEqual([])
  })
})

describe('computeDragUpdates', () => {
  const grouped = groupIssuesByStatus([
    issue('a', 'todo', 'a0'),
    issue('b', 'todo', 'a1'),
    issue('c', 'todo', 'a2'),
    issue('r', 'review', 'a0'),
  ])

  it('moves an issue to another status between neighbors', () => {
    const updates = computeDragUpdates(grouped, { cardId: 'b', toColumnId: 'review', toIndex: 0 })
    expect(updates).toHaveLength(1)
    expect(updates[0]!.statusId).toBe('review')
    // Sorts before r ('a0')
    expect(updates[0]!.sortOrder < 'a0').toBe(true)
  })

  it('reorders within a status', () => {
    const updates = computeDragUpdates(grouped, { cardId: 'a', toColumnId: 'todo', toIndex: 3 })
    expect(updates).toHaveLength(1)
    // Sorts after c ('a2'), the last card
    expect(updates[0]!.sortOrder > 'a2').toBe(true)
  })

  it('returns no updates when dropped in place', () => {
    expect(computeDragUpdates(grouped, { cardId: 'b', toColumnId: 'todo', toIndex: 1 })).toEqual([])
    expect(computeDragUpdates(grouped, { cardId: 'b', toColumnId: 'todo', toIndex: 2 })).toEqual([])
  })
})
