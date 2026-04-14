import type { Edge, Node } from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import type { WhiteboardNode } from '@/types/kanban'

const elk = new ELK()

const NODE_WIDTH = 280
const NODE_HEIGHT = 120

interface LayoutResult {
  nodes: Node[]
  edges: Edge[]
}

export async function computeLayout(
  flatNodes: WhiteboardNode[],
  collapsedIds: Set<string>,
  askingNodeId?: string | null,
): Promise<LayoutResult> {
  if (flatNodes.length === 0) {
    return { nodes: [], edges: [] }
  }

  // Build parent→children map
  const childrenMap = new Map<string | null, WhiteboardNode[]>()
  for (const n of flatNodes) {
    const parentId = n.parentId ?? null
    const list = childrenMap.get(parentId)
    if (list) list.push(n)
    else childrenMap.set(parentId, [n])
  }

  // Sort children by sortOrder
  for (const children of childrenMap.values()) {
    children.sort((a, b) => a.sortOrder.localeCompare(b.sortOrder))
  }

  // Collect visible nodes (skip children of collapsed nodes)
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

  const visibleIds = new Set(visibleNodes.map(n => n.id))

  // Build ELK graph
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'mrtree',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    },
    children: visibleNodes.map(n => ({
      id: n.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: visibleNodes
      .filter(n => n.parentId && visibleIds.has(n.parentId))
      .map(n => ({
        id: `e-${n.parentId}-${n.id}`,
        sources: [n.parentId!],
        targets: [n.id],
      })),
  }

  const layout = await elk.layout(elkGraph)

  const xyNodes: Node[] = (layout.children ?? []).map((elkNode) => {
    const original = flatNodes.find(n => n.id === elkNode.id)!
    const hasChildren = (childrenMap.get(elkNode.id)?.length ?? 0) > 0
    return {
      id: elkNode.id,
      type: 'mindmapNode',
      position: { x: elkNode.x ?? 0, y: elkNode.y ?? 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        ...original,
        hasChildren,
        isCollapsed: collapsedIds.has(elkNode.id),
        askingNodeId: askingNodeId ?? null,
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
      animated: false,
    }))

  return { nodes: xyNodes, edges: xyEdges }
}

export { NODE_HEIGHT, NODE_WIDTH }
