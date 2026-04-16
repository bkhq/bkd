import type { Edge, Node } from '@xyflow/react'
import dagre from 'dagre'
import type { WhiteboardNode } from '@/types/kanban'

const NODE_WIDTH = 360

/** Estimate node height based on content length (for initial layout before DOM measurement). */
function estimateNodeHeight(node: WhiteboardNode): number {
  const base = 72 // header + padding
  const content = node.content ?? ''
  if (!content) return base
  // Rough estimate: ~18px per line, ~50 chars per line at 360px width
  const lines = content.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 50)), 0)
  return Math.max(base, base + lines * 18)
}

/**
 * Synchronous tree layout using dagre.
 * Handles variable node sizes and prevents overlap automatically.
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

  // Build dagre graph — left-to-right tree layout
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',
    nodesep: 24,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  })
  g.setDefaultEdgeLabel(() => ({}))

  // Add nodes with estimated dimensions
  for (const n of visibleNodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: estimateNodeHeight(n) })
  }

  // Add edges (parent → child)
  for (const n of visibleNodes) {
    if (n.parentId && visibleIds.has(n.parentId)) {
      g.setEdge(n.parentId, n.id)
    }
  }

  dagre.layout(g)

  // Build xyflow nodes with positions from dagre
  // dagre positions are node centers — convert to top-left
  const xyNodes: Node[] = visibleNodes.map((n) => {
    const children = childrenMap.get(n.id) ?? []
    const parent = n.parentId ? nodeMap.get(n.parentId) : undefined
    const dagreNode = g.node(n.id)
    const position = dagreNode
      ? { x: dagreNode.x - NODE_WIDTH / 2, y: dagreNode.y - dagreNode.height / 2 }
      : { x: 0, y: 0 }
    return {
      id: n.id,
      type: 'mindmapNode',
      position,
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

  // Build edges using xyflow's built-in smoothstep
  const xyEdges: Edge[] = visibleNodes
    .filter(n => n.parentId && visibleIds.has(n.parentId))
    .map(n => ({
      id: `e-${n.parentId}-${n.id}`,
      source: n.parentId!,
      target: n.id,
      type: 'smoothstep',
    }))

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
