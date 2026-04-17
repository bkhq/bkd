import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { GenerateIssuesDialog } from '@/components/whiteboard/GenerateIssuesDialog'
import { WhiteboardCanvas } from '@/components/whiteboard/WhiteboardCanvas'
import { WhiteboardHeader } from '@/components/whiteboard/WhiteboardHeader'
import { useProject } from '@/hooks/use-kanban'
import {
  useCreateWhiteboardNode,
  useDeleteWhiteboardNode,
  useGenerateIssuesFromNodes,
  useUpdateWhiteboardNode,
  useWhiteboardAsk,
  useWhiteboardNodes,
} from '@/hooks/use-whiteboard'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'
import { computeNextSortOrder } from '@/lib/whiteboard-layout'

const LazyIssuePanel = lazy(() =>
  import('@/components/kanban/IssuePanel').then(m => ({ default: m.IssuePanel })),
)

interface GeneratedIssueItem {
  nodeId: string
  title: string
  prompt: string
}

export default function WhiteboardPage() {
  const { t } = useTranslation()
  const { projectId = '' } = useParams()
  const { data: project } = useProject(projectId)
  const { data: nodes = [], refetch: refetchNodes } = useWhiteboardNodes(projectId)
  const createNode = useCreateWhiteboardNode(projectId)
  const updateNode = useUpdateWhiteboardNode(projectId)
  const deleteNode = useDeleteWhiteboardNode(projectId)
  const askAI = useWhiteboardAsk(projectId)
  const generateIssues = useGenerateIssuesFromNodes(projectId)

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [askingNodeId, setAskingNodeId] = useState<string | null>(null)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [generatedItems, setGeneratedItems] = useState<GeneratedIssueItem[]>([])
  const [chatPanelOpen, setChatPanelOpen] = useState(false)
  const pendingGenerateNodeIds = useRef<string[]>([])

  // Derive the bound issue ID from the root node
  const boundIssueId = useMemo(() => {
    const root = nodes.find(n => !n.parentId)
    return root?.boundIssueId ?? null
  }, [nodes])

  // SSE subscription on the bound whiteboard issue — refetch nodes whenever
  // the AI finishes a turn. The server parses the AI's markdown response into
  // new child nodes, so the only thing the UI needs to do on `done` is reload.
  useEffect(() => {
    if (!boundIssueId) return

    let refetchTimer: ReturnType<typeof setTimeout> | null = null
    const unsub = eventBus.subscribe(boundIssueId, {
      onLog: () => {},
      onLogUpdated: () => {},
      onLogRemoved: () => {},
      onState: () => {},
      onDone: () => {
        setAskingNodeId(null)
        // Delay slightly so the last tool-call commit is flushed before refetch
        if (refetchTimer) clearTimeout(refetchTimer)
        refetchTimer = setTimeout(refetchNodes, 500)
      },
    })
    return () => {
      if (refetchTimer) clearTimeout(refetchTimer)
      unsub()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundIssueId])

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

  const onCreateRoot = useCallback(() => {
    const sortOrder = computeNextSortOrder(nodes, null)
    createNode.mutate({ label: project?.name ?? 'Root', sortOrder })
  }, [createNode, nodes, project?.name])

  const onAddChild = useCallback((parentId: string) => {
    const sortOrder = computeNextSortOrder(nodes, parentId)
    createNode.mutate(
      { parentId, label: '', sortOrder },
      {
        onSuccess: (newNode) => {
          // New empty-label child: dispatch a focus event so the freshly
          // mounted MindmapNode enters label-edit mode automatically.
          // Using a requestAnimationFrame gives xyflow a tick to mount the
          // node before the event fires.
          if (!newNode.label) {
            requestAnimationFrame(() => {
              window.dispatchEvent(new CustomEvent('wb:focus-node-label', {
                detail: { nodeId: newNode.id },
              }))
            })
          }
        },
      },
    )
  }, [createNode, nodes])

  const onUpdateNode = useCallback((nodeId: string, data: Record<string, unknown>) => {
    updateNode.mutate({ nodeId, ...data })
  }, [updateNode])

  const onDeleteNode = useCallback((nodeId: string) => {
    if (window.confirm(t('whiteboard.deleteConfirm'))) {
      deleteNode.mutate(nodeId)
    }
  }, [deleteNode, t])

  const onToggleCollapse = useCallback((nodeId: string, isCollapsed: boolean) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (isCollapsed) next.add(nodeId)
      else next.delete(nodeId)
      return next
    })
    updateNode.mutate({ nodeId, isCollapsed })
  }, [updateNode])

  // Handle wb:ask-ai custom event from MindmapNode.
  // The server parses the AI's markdown reply into new child nodes; we just
  // show a spinner on the focal node until SSE `done` fires.
  useEffect(() => {
    function handleAskAI(e: Event) {
      const { nodeId, prompt } = (e as CustomEvent).detail as { nodeId: string, prompt: string }
      if (!prompt) return
      setAskingNodeId(nodeId)
      askAI.mutate(
        { nodeId, prompt },
        {
          onError: () => setAskingNodeId(null),
        },
      )
    }
    window.addEventListener('wb:ask-ai', handleAskAI)
    return () => window.removeEventListener('wb:ask-ai', handleAskAI)
  }, [askAI])

  // Handle wb:generate-tree event from WhiteboardHeader
  useEffect(() => {
    function handleGenerateTree(e: Event) {
      const { topic } = (e as CustomEvent).detail as { topic: string }
      const treePrompt = `Generate a comprehensive mindmap about: ${topic}. Use the whiteboard-add-node tool to create 3-7 top-level subtopics as children of the root node, each with a short paragraph in content.`
      const rootNode = nodes.find(n => !n.parentId)
      if (rootNode) {
        setAskingNodeId(rootNode.id)
        askAI.mutate(
          { nodeId: rootNode.id, prompt: treePrompt },
          { onError: () => setAskingNodeId(null) },
        )
      } else {
        // Create root with the topic label, then ask
        createNode.mutate(
          { label: topic },
          {
            onSuccess: (newNode) => {
              setAskingNodeId(newNode.id)
              askAI.mutate(
                { nodeId: newNode.id, prompt: treePrompt },
                { onError: () => setAskingNodeId(null) },
              )
            },
          },
        )
      }
    }
    window.addEventListener('wb:generate-tree', handleGenerateTree)
    return () => window.removeEventListener('wb:generate-tree', handleGenerateTree)
  }, [askAI, createNode, nodes])

  // Handle wb:generate-issues event (can be dispatched from node context menu in future)
  useEffect(() => {
    function handleGenerateIssues(e: Event) {
      const { nodeIds } = (e as CustomEvent).detail as { nodeIds: string[] }
      pendingGenerateNodeIds.current = nodeIds
      generateIssues.mutate(
        { nodeIds },
        {
          onSuccess: (items) => {
            setGeneratedItems(items)
            setGenerateDialogOpen(true)
          },
        },
      )
    }
    window.addEventListener('wb:generate-issues', handleGenerateIssues)
    return () => window.removeEventListener('wb:generate-issues', handleGenerateIssues)
  }, [generateIssues])

  return (
    <div className="flex h-dvh flex-col">
      <WhiteboardHeader
        projectId={projectId}
        projectName={project?.name ?? ''}
        onCreateRoot={onCreateRoot}
        onReset={() => {
          if (window.confirm(t('whiteboard.resetConfirm'))) {
            kanbanApi.resetWhiteboard(projectId).then(() => refetchNodes())
          }
        }}
        hasNodes={nodes.length > 0}
        boundIssueId={boundIssueId}
        onToggleChat={() => setChatPanelOpen(prev => !prev)}
      />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1">
          <WhiteboardCanvas
            flatNodes={nodes}
            collapsedIds={collapsedIds}
            askingNodeId={askingNodeId}
            onAddChild={onAddChild}
            onUpdateNode={onUpdateNode}
            onDeleteNode={onDeleteNode}
            onToggleCollapse={onToggleCollapse}
            onReparent={(nodeId, newParentId) => {
              const sortOrder = computeNextSortOrder(nodes, newParentId, nodeId)
              updateNode.mutate({ nodeId, parentId: newParentId, sortOrder })
            }}
          />
        </div>
        {chatPanelOpen && boundIssueId && (
          <div className="w-[440px] shrink-0 border-l border-border">
            <Suspense fallback={null}>
              <LazyIssuePanel
                projectId={projectId}
                issueId={boundIssueId}
                onClose={() => setChatPanelOpen(false)}
                hideHeaderActions
              />
            </Suspense>
          </div>
        )}
      </div>
      <GenerateIssuesDialog
        projectId={projectId}
        items={generatedItems}
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        onCreated={() => setGenerateDialogOpen(false)}
      />
    </div>
  )
}
