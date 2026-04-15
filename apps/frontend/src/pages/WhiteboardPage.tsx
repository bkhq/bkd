import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { WhiteboardCanvas } from '@/components/whiteboard/WhiteboardCanvas'
import { WhiteboardHeader } from '@/components/whiteboard/WhiteboardHeader'
import { useProject } from '@/hooks/use-kanban'
import {
  useCreateWhiteboardNode,
  useDeleteWhiteboardNode,
  useUpdateWhiteboardNode,
  useWhiteboardAsk,
  useWhiteboardNodes,
} from '@/hooks/use-whiteboard'
import { eventBus } from '@/lib/event-bus'

export default function WhiteboardPage() {
  const { projectId = '' } = useParams()
  const { data: project } = useProject(projectId)
  const { data: nodes = [], refetch: refetchNodes } = useWhiteboardNodes(projectId)
  const createNode = useCreateWhiteboardNode(projectId)
  const updateNode = useUpdateWhiteboardNode(projectId)
  const deleteNode = useDeleteWhiteboardNode(projectId)
  const askAI = useWhiteboardAsk(projectId)

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [askingNodeId, setAskingNodeId] = useState<string | null>(null)
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null)

  // Sync collapsed state from server data
  const collapsedKey = nodes.map(n => `${n.id}:${n.isCollapsed}`).join(',')
  useEffect(() => {
    const collapsed = new Set<string>()
    for (const n of nodes) {
      if (n.isCollapsed) collapsed.add(n.id)
    }
    setCollapsedIds(collapsed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedKey])

  // Subscribe to SSE for the bound whiteboard issue to detect AI completion
  // Uses state (not ref) so changes trigger re-render and new subscription
  // Includes a 5-minute fallback timeout in case the done event is missed
  useEffect(() => {
    if (!pendingIssueId) return

    const clearLoading = () => {
      setPendingIssueId(null)
      setAskingNodeId(null)
      setTimeout(refetchNodes, 1000)
    }

    // Fallback: clear loading after 5 min if done event is missed (SSE drop)
    const fallbackTimer = setTimeout(clearLoading, 5 * 60 * 1000)

    const unsub = eventBus.subscribe(pendingIssueId, {
      onLog: () => {},
      onLogUpdated: () => {},
      onLogRemoved: () => {},
      onState: () => {},
      onDone: () => {
        clearTimeout(fallbackTimer)
        clearLoading()
      },
    })
    return () => {
      clearTimeout(fallbackTimer)
      unsub()
    }
  }, [pendingIssueId, refetchNodes])

  const onCreateRoot = useCallback(() => {
    createNode.mutate({ label: project?.name ?? 'Root' })
  }, [createNode, project?.name])

  const onAddChild = useCallback((parentId: string) => {
    createNode.mutate({ parentId, label: '' })
  }, [createNode])

  const onUpdateNode = useCallback((nodeId: string, data: Record<string, unknown>) => {
    updateNode.mutate({ nodeId, ...data })
  }, [updateNode])

  const onDeleteNode = useCallback((nodeId: string) => {
    deleteNode.mutate(nodeId)
  }, [deleteNode])

  const onToggleCollapse = useCallback((nodeId: string, isCollapsed: boolean) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (isCollapsed) next.add(nodeId)
      else next.delete(nodeId)
      return next
    })
    updateNode.mutate({ nodeId, isCollapsed })
  }, [updateNode])

  // Handle wb:ask-ai custom event from MindmapNode
  useEffect(() => {
    function handleAskAI(e: Event) {
      const { nodeId, action, prompt } = (e as CustomEvent).detail
      setAskingNodeId(nodeId)
      askAI.mutate(
        { nodeId, action, prompt },
        {
          onSuccess: (data) => {
            setPendingIssueId(data.issueId)
          },
          onError: () => {
            setAskingNodeId(null)
          },
        },
      )
    }
    window.addEventListener('wb:ask-ai', handleAskAI)
    return () => window.removeEventListener('wb:ask-ai', handleAskAI)
  }, [askAI])

  return (
    <div className="flex h-dvh flex-col">
      <WhiteboardHeader
        projectId={projectId}
        projectName={project?.name ?? ''}
        onCreateRoot={onCreateRoot}
        hasNodes={nodes.length > 0}
      />
      <div className="flex-1">
        <WhiteboardCanvas
          flatNodes={nodes}
          collapsedIds={collapsedIds}
          askingNodeId={askingNodeId}
          onAddChild={onAddChild}
          onUpdateNode={onUpdateNode}
          onDeleteNode={onDeleteNode}
          onToggleCollapse={onToggleCollapse}
        />
      </div>
    </div>
  )
}
