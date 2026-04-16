import type { Edge, Node } from '@xyflow/react'
import type { WhiteboardNode } from '@/types/kanban'

const NODE_WIDTH = 360
const NODE_HEIGHT_MIN = 80
const H_GAP = 80
const V_GAP = 24

/** Estimate node height based on content length. */
function estimateNodeHeight(node: WhiteboardNode): number {
  // Header: ~32px, toolbar: ~28px, padding: ~24px = ~84px base
  const base = 84
  const content = node.content ?? ''
  if (!content) return NODE_HEIGHT_MIN
  // Rough estimate: ~18px per line, ~50 chars per line at 360px width
  const lines = content.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 50)), 0)
  return Math.max(NODE_HEIGHT_MIN, base + lines * 18)
}

/**
 * Synchronous tree layout — computes positions and edges in one pass.
 * No elkjs, no async, no two-phase rendering needed.
 */
export function layoutMindmap(
  flatNodes: WhiteboardNode[],
  collapsedIds: Set<string>,
  askingNodeId?: string | null,
): { nodes: Node[], edges: Edge[] } {
  if (flatNodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  const childrenMap = buildChildrenMap(flatNodes)
  const nodeMap = new Map(flatNodes.map(n => [n.id, n]))
  const visibleNodes = collectVisibleNodes(childrenMap, collapsedIds)
  const visibleIds = new Set(visibleNodes.map(n => n.id))

  // Build visible children map (only visible nodes)
  const visibleChildrenMap = new Map<string, WhiteboardNode[]>()
  for (const n of visibleNodes) {
    if (!n.parentId || !visibleIds.has(n.parentId)) continue
    const list = visibleChildrenMap.get(n.parentId)
    if (list) list.push(n)
    else visibleChildrenMap.set(n.parentId, [n])
  }

  // Pre-compute estimated heights for each node based on content
  const nodeHeight = new Map<string, number>()
  for (const n of visibleNodes) {
    nodeHeight.set(n.id, estimateNodeHeight(n))
  }

  // Compute subtree heights (bottom-up) for vertical centering
  const subtreeHeight = new Map<string, number>()
  function getSubtreeHeight(id: string): number {
    const cached = subtreeHeight.get(id)
    if (cached !== undefined) return cached
    const selfHeight = nodeHeight.get(id) ?? NODE_HEIGHT_MIN
    const children = visibleChildrenMap.get(id)
    if (!children || children.length === 0) {
      subtreeHeight.set(id, selfHeight)
      return selfHeight
    }
    const totalChildHeight = children.reduce((sum, c) => sum + getSubtreeHeight(c.id), 0)
      + (children.length - 1) * V_GAP
    const height = Math.max(selfHeight, totalChildHeight)
    subtreeHeight.set(id, height)
    return height
  }

  // Compute positions (root at left, children to the right)
  const positions = new Map<string, { x: number, y: number }>()
  const roots = visibleNodes.filter(n => !n.parentId || !visibleIds.has(n.parentId))

  // Layout each root tree
  let rootY = 0
  for (const root of roots) {
    layoutSubtree(root.id, 0, rootY, getSubtreeHeight(root.id))
    rootY += getSubtreeHeight(root.id) + V_GAP * 2
  }

  function layoutSubtree(nodeId: string, x: number, yStart: number, availableHeight: number) {
    const selfHeight = nodeHeight.get(nodeId) ?? NODE_HEIGHT_MIN
    // Center this node vertically in its available space
    const y = yStart + (availableHeight - selfHeight) / 2
    positions.set(nodeId, { x, y })

    const children = visibleChildrenMap.get(nodeId)
    if (!children || children.length === 0) return

    const childX = x + NODE_WIDTH + H_GAP
    let childY = yStart
    for (const child of children) {
      const childHeight = getSubtreeHeight(child.id)
      layoutSubtree(child.id, childX, childY, childHeight)
      childY += childHeight + V_GAP
    }
  }

  // Build xyflow nodes
  const xyNodes: Node[] = visibleNodes.map((n) => {
    const children = childrenMap.get(n.id) ?? []
    const parent = n.parentId ? nodeMap.get(n.parentId) : undefined
    const pos = positions.get(n.id) ?? { x: 0, y: 0 }
    return {
      id: n.id,
      type: 'mindmapNode',
      position: pos,
      data: {
        ...n,
        hasChildren: children.length > 0,
        childCount: children.length,
        isCollapsed: collapsedIds.has(n.id),
        askingNodeId: askingNodeId ?? null,
        parentLabel: parent?.label ?? null,
        childLabels: children.map(c => c.label).filter(Boolean),
      },
    }
  })

  // Build edges with pre-computed positions (avoids per-edge useNodes subscription)
  const xyEdges: Edge[] = visibleNodes
    .filter(n => n.parentId && visibleIds.has(n.parentId))
    .map((n) => {
      const sourcePos = positions.get(n.parentId!) ?? { x: 0, y: 0 }
      const targetPos = positions.get(n.id) ?? { x: 0, y: 0 }
      const sourceH = nodeHeight.get(n.parentId!) ?? NODE_HEIGHT_MIN
      const targetH = nodeHeight.get(n.id) ?? NODE_HEIGHT_MIN
      return {
        id: `e-${n.parentId}-${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: 'mindmapEdge',
        data: {
          sourceX: sourcePos.x + NODE_WIDTH,
          sourceY: sourcePos.y + sourceH / 2,
          targetX: targetPos.x,
          targetY: targetPos.y + targetH / 2,
        },
      }
    })

  return { nodes: xyNodes, edges: xyEdges }
}

function buildChildrenMap(flatNodes: WhiteboardNode[]) {
  const map = new Map<string | null, WhiteboardNode[]>()
  for (const n of flatNodes) {
    const parentId = n.parentId ?? null
    const list = map.get(parentId)
    if (list) list.push(n)
    else map.set(parentId, [n])
  }
  for (const children of map.values()) {
    children.sort((a, b) => a.sortOrder.localeCompare(b.sortOrder))
  }
  return map
}

function collectVisibleNodes(
  childrenMap: Map<string | null, WhiteboardNode[]>,
  collapsedIds: Set<string>,
) {
  const visibleNodes: WhiteboardNode[] = []
  const roots = childrenMap.get(null) ?? []
  const queue = [...roots]
  while (queue.length > 0) {
    const node = queue.shift()!
    visibleNodes.push(node)
    if (!collapsedIds.has(node.id)) {
      const children = childrenMap.get(node.id)
      if (children) queue.push(...children)
    }
  }
  return visibleNodes
}
