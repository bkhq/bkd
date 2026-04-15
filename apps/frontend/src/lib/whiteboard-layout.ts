import type { Edge, Node } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { WhiteboardNode } from '@/types/kanban'

const elk = new ELK()

const DEFAULT_NODE_WIDTH = 280
const DEFAULT_NODE_HEIGHT = 80

interface LayoutResult {
  nodes: Node[]
  edges: Edge[]
}

/**
 * Build initial xyflow nodes/edges from flat data (no positions yet).
 * xyflow will mount these to measure their real DOM dimensions.
 */
export function buildInitialNodes(
  flatNodes: WhiteboardNode[],
  collapsedIds: Set<string>,
  askingNodeId?: string | null,
): LayoutResult {
  if (flatNodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  const childrenMap = buildChildrenMap(flatNodes)
  const visibleNodes = collectVisibleNodes(childrenMap, collapsedIds)
  const visibleIds = new Set(visibleNodes.map(n => n.id))

  const xyNodes: Node[] = visibleNodes.map(n => ({
    id: n.id,
    type: 'mindmapNode',
    position: { x: 0, y: 0 },
    data: {
      ...n,
      hasChildren: (childrenMap.get(n.id)?.length ?? 0) > 0,
      isCollapsed: collapsedIds.has(n.id),
      askingNodeId: askingNodeId ?? null,
    },
  }))

  const xyEdges = buildEdges(visibleNodes, visibleIds)

  return { nodes: xyNodes, edges: xyEdges }
}

/**
 * Run elkjs layout using measured node dimensions from xyflow DOM.
 * Returns nodes with computed positions.
 */
export async function computeLayout(
  currentNodes: Node[],
  currentEdges: Edge[],
): Promise<LayoutResult> {
  if (currentNodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'mrtree',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    },
    children: currentNodes.map(n => ({
      id: n.id,
      width: n.measured?.width ?? DEFAULT_NODE_WIDTH,
      height: n.measured?.height ?? DEFAULT_NODE_HEIGHT,
    })),
    edges: currentEdges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  }

  const layout = await elk.layout(elkGraph)

  const positionMap = new Map<string, { x: number, y: number }>()
  for (const child of layout.children ?? []) {
    positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
  }

  const layoutedNodes: Node[] = currentNodes.map(n => ({
    ...n,
    position: positionMap.get(n.id) ?? n.position,
  }))

  return { nodes: layoutedNodes, edges: currentEdges }
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

function buildEdges(visibleNodes: WhiteboardNode[], visibleIds: Set<string>): Edge[] {
  return visibleNodes
    .filter(n => n.parentId && visibleIds.has(n.parentId))
    .map(n => ({
      id: `e-${n.parentId}-${n.id}`,
      source: n.parentId!,
      target: n.id,
      type: 'smoothstep',
      animated: false,
    }))
}
