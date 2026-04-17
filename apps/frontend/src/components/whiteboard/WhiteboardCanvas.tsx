import type { NodeTypes, Edge as XYEdge, Node as XYNode } from '@xyflow/react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getVisibleNodeIds,
  layoutMindmap,
  relayoutWithMeasured,
} from '@/lib/whiteboard-layout'
import type { WhiteboardNode } from '@/types/kanban'
import { MindmapNode } from './MindmapNode'

const nodeTypes: NodeTypes = {
  mindmapNode: MindmapNode,
}

interface WhiteboardCanvasProps {
  flatNodes: WhiteboardNode[]
  collapsedIds: Set<string>
  askingNodeId: string | null
  onAddChild: (parentId: string) => void
  onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void
  onDeleteNode: (nodeId: string) => void
  onToggleCollapse: (nodeId: string, isCollapsed: boolean) => void
  onReparent: (nodeId: string, newParentId: string) => void
}

export function WhiteboardCanvas(props: WhiteboardCanvasProps) {
  const { t } = useTranslation()

  if (props.flatNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t('whiteboard.empty')}
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <LayoutedFlow {...props} />
    </ReactFlowProvider>
  )
}

/** Build structural signature: anything that affects tree topology and triggers re-layout */
function buildStructureKey(flatNodes: WhiteboardNode[], collapsedIds: Set<string>): string {
  const structure = flatNodes
    .map(n => `${n.id}:${n.parentId ?? ''}:${n.sortOrder}`)
    .sort()
    .join(',')
  const collapsed = [...collapsedIds].toSorted().join(',')
  return `${structure}|${collapsed}`
}

function LayoutedFlow({
  flatNodes,
  collapsedIds,
  askingNodeId,
  onAddChild,
  onUpdateNode,
  onDeleteNode,
  onToggleCollapse,
  onReparent,
}: WhiteboardCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<XYNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<XYEdge>([])
  const { fitView, getIntersectingNodes } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const structureKey = buildStructureKey(flatNodes, collapsedIds)
  const prevStructureRef = useRef('')
  const hasFitInitialRef = useRef(false)

  // Listen for custom events from MindmapNode
  useEffect(() => {
    function handleAddChild(e: Event) {
      const { parentId } = (e as CustomEvent).detail
      onAddChild(parentId)
    }
    function handleUpdateNode(e: Event) {
      const { nodeId, ...data } = (e as CustomEvent).detail
      onUpdateNode(nodeId, data)
    }
    function handleDeleteNode(e: Event) {
      const { nodeId } = (e as CustomEvent).detail
      onDeleteNode(nodeId)
    }
    function handleToggleCollapse(e: Event) {
      const { nodeId, isCollapsed } = (e as CustomEvent).detail
      onToggleCollapse(nodeId, isCollapsed)
    }

    window.addEventListener('wb:add-child', handleAddChild)
    window.addEventListener('wb:update-node', handleUpdateNode)
    window.addEventListener('wb:delete-node', handleDeleteNode)
    window.addEventListener('wb:toggle-collapse', handleToggleCollapse)
    return () => {
      window.removeEventListener('wb:add-child', handleAddChild)
      window.removeEventListener('wb:update-node', handleUpdateNode)
      window.removeEventListener('wb:delete-node', handleDeleteNode)
      window.removeEventListener('wb:toggle-collapse', handleToggleCollapse)
    }
  }, [onAddChild, onUpdateNode, onDeleteNode, onToggleCollapse])

  // Structural layout — only runs when tree structure changes (add/remove/reparent/collapse)
  useEffect(() => {
    if (prevStructureRef.current === structureKey) return
    prevStructureRef.current = structureKey

    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutMindmap(
      flatNodes,
      collapsedIds,
      askingNodeId,
    )
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey])

  // Patch node data (label/content/icon) in place without re-layout
  useEffect(() => {
    setNodes(currentNodes => currentNodes.map((n) => {
      const fresh = flatNodes.find(f => f.id === n.id)
      if (!fresh) return n
      // Keep position; only update data fields that can change without affecting layout
      return {
        ...n,
        data: {
          ...n.data,
          label: fresh.label,
          content: fresh.content,
          icon: fresh.icon,
          askingNodeId: askingNodeId ?? null,
        },
      }
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatNodes, askingNodeId])

  // One-shot measured re-layout on structural changes only.
  //
  // CRITICAL ordering detail: the structural effect above calls `setNodes()`
  // with the new visible list, but that update is batched and only commits
  // on the NEXT render. If this effect runs in the SAME render as the
  // structural one, `nodes` (and `getNodes()`) still reflect the OLD list —
  // iterating it and calling `setNodes(relayouted)` would overwrite the
  // structural result, re-introducing hidden nodes (e.g. children of a
  // just-collapsed parent). To prevent that, we gate on a match between the
  // current `nodes` array and the expected visible set for this structureKey.
  // On the first render after a structural change the gate rejects; on the
  // next render (after commit) it passes and we apply measured heights.
  const measuredVersionRef = useRef('')
  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return
    if (measuredVersionRef.current === structureKey) return

    const visibleIds = getVisibleNodeIds(flatNodes, collapsedIds)
    if (nodes.length !== visibleIds.size) return
    for (const n of nodes) {
      if (!visibleIds.has(n.id)) return
    }

    measuredVersionRef.current = structureKey
    const relayouted = relayoutWithMeasured(flatNodes, collapsedIds, nodes)
    setNodes(relayouted)

    // Only fitView on first mount to avoid jarring zoom on every edit
    if (!hasFitInitialRef.current) {
      hasFitInitialRef.current = true
      requestAnimationFrame(() => fitView({ padding: 0.3, duration: 400 }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized, structureKey, nodes])

  const defaultEdgeOptions = useMemo(() => ({
    style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, opacity: 0.6 },
    type: 'smoothstep',
  }), [])

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])

  // Drag-to-reparent: when a node is dropped on another, reparent it.
  //
  // When the drop is invalid (empty space or cycle-inducing), we snap back by
  // recomputing the layout with `relayoutWithMeasured` against the current
  // xyflow nodes. That preserves each node's DOM-measured height, so snapping
  // back looks identical to the pre-drag state instead of briefly collapsing
  // to estimated heights (which caused a visible flash).
  const snapBackToLayout = useCallback(() => {
    setNodes(current => relayoutWithMeasured(flatNodes, collapsedIds, current))
  }, [flatNodes, collapsedIds, setNodes])

  const onNodeDragStop = useCallback((_e: React.MouseEvent, draggedNode: XYNode) => {
    const intersections = getIntersectingNodes(draggedNode)
      .filter(n => n.id !== draggedNode.id)
    const dropTarget = intersections[0]
    if (!dropTarget) {
      snapBackToLayout()
      return
    }
    const draggedId = draggedNode.id
    const targetId = dropTarget.id
    if (isDescendantOf(flatNodes, targetId, draggedId)) {
      snapBackToLayout()
      return
    }
    onReparent(draggedId, targetId)
  }, [getIntersectingNodes, onReparent, flatNodes, snapBackToLayout])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={nodeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      proOptions={proOptions}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

/** Check if `candidateAncestor` is an ancestor of `nodeId` in the tree. */
function isDescendantOf(flatNodes: WhiteboardNode[], nodeId: string, candidateAncestor: string): boolean {
  const nodeMap = new Map(flatNodes.map(n => [n.id, n]))
  const visited = new Set<string>()
  let current = nodeMap.get(nodeId)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.parentId === candidateAncestor) return true
    current = current.parentId ? nodeMap.get(current.parentId) : undefined
  }
  return false
}
