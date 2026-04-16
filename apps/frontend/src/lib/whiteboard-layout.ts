import type { Edge, Node } from '@xyflow/react'
import dagre from 'dagre'
import type { WhiteboardNode } from '@/types/kanban'

const NODE_WIDTH = 360
const NODESEP = 60
const RANKSEP = 100

/** Estimate node height from content length (initial pass before DOM measurement). */
function estimateNodeHeight(node: WhiteboardNode): number {
  const base = 88 // header + padding + bottom spacing
  const content = node.content ?? ''
  if (!content) return base
  const lines = content.split('\n').reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / 50)),
    0,
  )
  return Math.max(base, base + lines * 20)
}

function buildDagreGraph(
  visibleNodes: WhiteboardNode[],
  visibleIds: Set<string>,
  getHeight: (nodeId: string) => number,
) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',
    nodesep: NODESEP,
    ranksep: RANKSEP,
    marginx: 20,
    marginy: 20,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of visibleNodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: getHeight(n.id) })
  }
  for (const n of visibleNodes) {
    if (n.parentId && visibleIds.has(n.parentId)) {
      g.setEdge(n.parentId, n.id)
    }
  }
  dagre.layout(g)
  return g
}

/**
 * Initial layout using estimated heights.
 * Used on first render and whenever node topology changes.
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

  const g = buildDagreGraph(visibleNodes, visibleIds, (id) => {
    const n = nodeMap.get(id)
    return n ? estimateNodeHeight(n) : 100
  })

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

/**
 * Re-layout using DOM-measured heights from xyflow's node.measured.
 * Run after useNodesInitialized becomes true to fix overlap from estimation errors.
 */
export function relayoutWithMeasured(
  flatNodes: WhiteboardNode[],
  collapsedIds: Set<string>,
  measuredNodes: Node[],
): Node[] {
  if (flatNodes.length === 0 || measuredNodes.length === 0) return measuredNodes

  const childrenMap = buildChildrenMap(flatNodes)
  const visibleNodes = collectVisibleNodes(childrenMap, collapsedIds)
  const visibleIds = new Set(visibleNodes.map(n => n.id))

  const measuredMap = new Map(
    measuredNodes.map(n => [n.id, n.measured?.height ?? 100]),
  )

  const g = buildDagreGraph(visibleNodes, visibleIds, id => measuredMap.get(id) ?? 100)

  return measuredNodes.map((n) => {
    const dagreNode = g.node(n.id)
    if (!dagreNode) return n
    const height = n.measured?.height ?? dagreNode.height
    return {
      ...n,
      position: {
        x: dagreNode.x - NODE_WIDTH / 2,
        y: dagreNode.y - height / 2,
      },
    }
  })
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
