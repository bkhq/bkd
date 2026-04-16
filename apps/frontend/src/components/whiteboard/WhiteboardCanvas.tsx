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
import { layoutMindmap, relayoutWithMeasured } from '@/lib/whiteboard-layout'
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
  const { fitView, getIntersectingNodes, getNodes } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const layoutVersionRef = useRef(0)

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

  // Phase 1: initial layout with estimated heights
  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutMindmap(
      flatNodes,
      collapsedIds,
      askingNodeId,
    )
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
    layoutVersionRef.current += 1
  }, [flatNodes, collapsedIds, askingNodeId, setNodes, setEdges])

  // Phase 2: after xyflow measures DOM, re-run dagre with actual heights to fix overlap
  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return
    const version = layoutVersionRef.current
    const measuredNodes = getNodes()
    // Only re-layout if any measured height differs from position assumptions
    const relayouted = relayoutWithMeasured(flatNodes, collapsedIds, measuredNodes)
    // Skip if another update has happened
    if (layoutVersionRef.current !== version) return
    setNodes(relayouted)
    requestAnimationFrame(() => fitView({ padding: 0.3, duration: 200 }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesInitialized, flatNodes, collapsedIds])

  const defaultEdgeOptions = useMemo(() => ({
    style: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5, opacity: 0.6 },
    type: 'smoothstep',
  }), [])

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])

  // Drag-to-reparent: when a node is dropped on another, reparent it.
  const onNodeDragStop = useCallback((_e: React.MouseEvent, draggedNode: XYNode) => {
    const intersections = getIntersectingNodes(draggedNode)
      .filter(n => n.id !== draggedNode.id)
    const dropTarget = intersections[0]
    if (!dropTarget) {
      // Dropped in empty space — snap back to layout by triggering re-layout
      const { nodes: relayouted } = layoutMindmap(flatNodes, collapsedIds, askingNodeId)
      setNodes(relayouted)
      return
    }
    // Prevent circular parent: can't drop a node onto its own descendant
    const draggedId = draggedNode.id
    const targetId = dropTarget.id
    if (isDescendantOf(flatNodes, targetId, draggedId)) {
      const { nodes: relayouted } = layoutMindmap(flatNodes, collapsedIds, askingNodeId)
      setNodes(relayouted)
      return
    }
    onReparent(draggedId, targetId)
  }, [getIntersectingNodes, onReparent, flatNodes, collapsedIds, askingNodeId, setNodes])

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
