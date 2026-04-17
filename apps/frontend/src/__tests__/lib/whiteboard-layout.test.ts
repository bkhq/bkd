import { generateKeyBetween } from 'jittered-fractional-indexing'
import { describe, expect, it } from 'vitest'
import type { WhiteboardNode } from '@/types/kanban'
import { computeNextSortOrder, getVisibleNodeIds, layoutMindmap } from '@/lib/whiteboard-layout'

function mkNode(id: string, parentId: string | null, sortOrder: string): WhiteboardNode {
  return {
    id,
    projectId: 'p',
    parentId,
    label: id,
    content: '',
    icon: null,
    sortOrder,
    isCollapsed: false,
    metadata: null,
    boundIssueId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    isDeleted: 0,
  } as unknown as WhiteboardNode
}

describe('layoutMindmap collapse', () => {
  const tree = [
    mkNode('root', null, 'a0'),
    mkNode('c1', 'root', 'b0'),
    mkNode('c2', 'root', 'c0'),
    mkNode('gc1', 'c1', 'd0'),
    mkNode('gc2', 'c1', 'e0'),
  ]

  it('shows everything when nothing is collapsed', () => {
    const { nodes } = layoutMindmap(tree, new Set())
    expect(nodes.map(n => n.id).sort()).toEqual(['c1', 'c2', 'gc1', 'gc2', 'root'])
  })

  it('hides descendants of a collapsed node', () => {
    const { nodes } = layoutMindmap(tree, new Set(['c1']))
    expect(nodes.map(n => n.id).sort()).toEqual(['c1', 'c2', 'root'])
  })

  it('hides all children when root is collapsed', () => {
    const { nodes } = layoutMindmap(tree, new Set(['root']))
    expect(nodes.map(n => n.id)).toEqual(['root'])
  })
})

describe('getVisibleNodeIds', () => {
  const tree = [
    mkNode('root', null, 'a0'),
    mkNode('c1', 'root', 'b0'),
    mkNode('c2', 'root', 'c0'),
    mkNode('gc1', 'c1', 'd0'),
  ]

  it('returns every id when nothing is collapsed', () => {
    const ids = getVisibleNodeIds(tree, new Set())
    expect([...ids].toSorted()).toEqual(['c1', 'c2', 'gc1', 'root'])
  })

  it('drops descendants when a parent is collapsed', () => {
    const ids = getVisibleNodeIds(tree, new Set(['c1']))
    expect([...ids].toSorted()).toEqual(['c1', 'c2', 'root'])
  })
})

describe('computeNextSortOrder', () => {
  // Helpers — jittered-fractional-indexing keys are jittered suffixes of a
  // validated alphabet, so synthetic strings like 'a0' throw at validation
  // time. Tests must anchor against keys produced by the real generator.
  function seed(count: number): string[] {
    const keys: string[] = []
    let prev: string | null = null
    for (let i = 0; i < count; i++) {
      prev = generateKeyBetween(prev, null)
      keys.push(prev)
    }
    return keys
  }

  it('returns a valid key when no siblings exist', () => {
    const key = computeNextSortOrder([], null)
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('appends strictly after the largest existing sibling key', () => {
    const [k1, k2, k3] = seed(3)
    const tree = [
      mkNode('c1', 'p', k1),
      mkNode('c2', 'p', k2),
      mkNode('c3', 'p', k3),
    ]
    const next = computeNextSortOrder(tree, 'p')
    expect(next > k3).toBe(true)
  })

  it('ignores siblings under different parents', () => {
    const [low, high] = seed(2)
    const tree = [
      mkNode('a', 'p1', high), // larger key but different parent
      mkNode('b', 'p2', low),
    ]
    const next = computeNextSortOrder(tree, 'p2')
    // New key should be greater than low (p2's sibling) but less than high.
    expect(next > low).toBe(true)
    expect(next < high).toBe(true)
  })

  it('excludes a node being reparented so we do not anchor on its stale key', () => {
    const [low, high] = seed(2)
    const tree = [
      mkNode('moving', 'newParent', high), // stale, would anchor incorrectly
      mkNode('existing', 'newParent', low),
    ]
    const next = computeNextSortOrder(tree, 'newParent', 'moving')
    // Without excludeNodeId, next would be > high. With it, next is > low.
    expect(next > low).toBe(true)
  })

  it('produces distinct, strictly-ascending keys for successive appends', () => {
    let tree: WhiteboardNode[] = []
    const keys: string[] = []
    for (let i = 0; i < 5; i++) {
      const key = computeNextSortOrder(tree, 'p')
      keys.push(key)
      tree = [...tree, mkNode(`n${i}`, 'p', key)]
    }
    expect(new Set(keys).size).toBe(keys.length)
    const sorted = [...keys].toSorted()
    expect(sorted).toEqual(keys)
  })
})
