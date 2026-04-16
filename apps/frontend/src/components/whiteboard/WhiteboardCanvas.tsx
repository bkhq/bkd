import type { EdgeTypes, NodeTypes, Edge as XYEdge, Node as XYNode } from '@xyflow/react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { layoutMindmap } from '@/lib/whiteboard-layout'
import type { WhiteboardNode } from '@/types/kanban'
import { MindmapEdge } from './MindmapEdge'
import { MindmapNode } from './MindmapNode'

const nodeTypes: NodeTypes = {
  mindmapNode: MindmapNode,
}

const edgeTypes: EdgeTypes = {
  mindmapEdge: MindmapEdge,
}

interface WhiteboardCanvasProps {
  flatNodes: WhiteboardNode[]
  collapsedIds: Set<string>
  askingNodeId: string | null
  onAddChild: (parentId: string) => void
  onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void
  onDeleteNode: (nodeId: string) => void
  onToggleCollapse: (nodeId: string, isCollapsed: boolean) => void
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
}: WhiteboardCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<XYNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<XYEdge>([])
  const { fitView } = useReactFlow()

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

  // Synchronous layout + auto fitView after every change
  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutMindmap(
      flatNodes,
      collapsedIds,
      askingNodeId,
    )
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
    // fitView after React renders the new nodes
    requestAnimationFrame(() => fitView({ padding: 0.3, duration: 200 }))
  }, [flatNodes, collapsedIds, askingNodeId, setNodes, setEdges, fitView])

  const defaultEdgeOptions = useMemo(() => ({
    style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1.5 },
  }), [])

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      proOptions={proOptions}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.2}
      maxZoom={2}
      nodesDraggable={false}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
