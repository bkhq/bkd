import type { NodeTypes, Edge as XYEdge, Node as XYNode } from '@xyflow/react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { buildInitialNodes, computeLayout } from '@/lib/whiteboard-layout'
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
  const dataKeyRef = useRef('')
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

  // Phase 1: set initial nodes at origin for xyflow to measure
  // Key includes IDs, labels, content, parentIds, collapsed state, and askingNodeId
  // so any topology or content change triggers a rebuild
  const dataKey = `${flatNodes.map(n => `${n.id}:${n.parentId ?? ''}:${n.label}:${n.content}`).join(',')
  }|${[...collapsedIds].join(',')}`
  + `|${askingNodeId ?? ''}`

  useEffect(() => {
    if (dataKey === dataKeyRef.current) return
    dataKeyRef.current = dataKey
    layoutVersionRef.current += 1
    const version = layoutVersionRef.current

    const { nodes: initialNodes, edges: initialEdges } = buildInitialNodes(
      flatNodes,
      collapsedIds,
      askingNodeId,
    )
    setNodes(initialNodes)
    setEdges(initialEdges)

    // After xyflow measures the new nodes (next frames), run elkjs layout
    // with real DOM dimensions and apply positions.
    const scheduleLayout = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (layoutVersionRef.current !== version) return
          // Read latest nodes/edges from xyflow state (with measured dimensions)
          setNodes((currentNodes) => {
            setEdges((currentEdges) => {
              computeLayout(currentNodes, currentEdges).then((result) => {
                if (layoutVersionRef.current !== version) return
                setNodes(result.nodes)
                setEdges(result.edges)
                requestAnimationFrame(() => fitView({ padding: 0.3, duration: 200 }))
              })
              return currentEdges
            })
            return currentNodes
          })
        })
      })
    }
    scheduleLayout()
  }, [dataKey, flatNodes, collapsedIds, askingNodeId, setNodes, setEdges, fitView])

  const defaultEdgeOptions = useMemo(() => ({
    style: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1.5 },
  }), [])

  const proOptions = useMemo(() => ({ hideAttribution: true }), [])

  const onNodeDoubleClick = useCallback((_event: React.MouseEvent, node: { id: string }) => {
    void node
  }, [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDoubleClick={onNodeDoubleClick}
      nodeTypes={nodeTypes}
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
      <MiniMap
        nodeColor="hsl(var(--muted))"
        maskColor="hsl(var(--background) / 0.7)"
        className="!bg-background !border-border"
      />
    </ReactFlow>
  )
}
