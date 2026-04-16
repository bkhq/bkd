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
  useParseWhiteboardResponse,
  useUpdateWhiteboardNode,
  useWhiteboardAsk,
  useWhiteboardNodes,
} from '@/hooks/use-whiteboard'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'

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
  const parseResponse = useParseWhiteboardResponse(projectId)
  const generateIssues = useGenerateIssuesFromNodes(projectId)

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [askingNodeId, setAskingNodeId] = useState<string | null>(null)
  // pendingIssueId drives SSE subscription — must be state (not ref) to trigger re-render
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null)
  // Tracks target nodeId and action type for post-AI-done processing
  const pendingNodeRef = useRef<string | null>(null)
  const pendingActionRef = useRef<string | null>(null)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [generatedItems, setGeneratedItems] = useState<GeneratedIssueItem[]>([])
  const [chatPanelOpen, setChatPanelOpen] = useState(false)
  const pendingGenerateNodeIds = useRef<string[]>([])

  // Derive the bound issue ID from the root node
  const boundIssueId = useMemo(() => {
    const root = nodes.find(n => !n.parentId)
    return root?.boundIssueId ?? null
  }, [nodes])

  // Use ref to track AskAI-in-progress so persistent subscription can check without re-subscribing
  const askInProgressRef = useRef(false)

  // Keep ref in sync with pendingIssueId state
  useEffect(() => {
    askInProgressRef.current = !!pendingIssueId
  }, [pendingIssueId])

  // Keep root node ID in a ref so the persistent subscription can read it without re-subscribing
  const rootNodeIdRef = useRef<string | null>(null)
  useEffect(() => {
    rootNodeIdRef.current = nodes.find(n => !n.parentId)?.id ?? null
  }, [nodes])

  // Persistent SSE subscription on bound issue — handles chat-panel-initiated conversations.
  // When AI completes a turn from the chat panel, auto-parse ## headings into child nodes on root.
  useEffect(() => {
    if (!boundIssueId) return

    const unsub = eventBus.subscribe(boundIssueId, {
      onLog: () => {},
      onLogUpdated: () => {},
      onLogRemoved: () => {},
      onState: () => {},
      onDone: () => {
        // Skip if AskAI subscription is handling this turn
        if (askInProgressRef.current) return
        const rootId = rootNodeIdRef.current
        if (!rootId) return
        parseResponse.mutate(
          { nodeId: rootId, issueId: boundIssueId },
          { onSettled: () => setTimeout(refetchNodes, 500) },
        )
      },
    })
    return unsub
  // Only re-subscribe when boundIssueId changes — refs handle the rest
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

  // Subscribe to SSE for the pending whiteboard issue.
  // On AI done: explore/examples → parse-response (create children),
  // explain/simplify → fetch AI response and update node content.
  useEffect(() => {
    if (!pendingIssueId) return

    const issueId = pendingIssueId
    const nodeId = pendingNodeRef.current
    const action = pendingActionRef.current

    const clearLoading = (handleResult = false) => {
      setPendingIssueId(null)
      pendingNodeRef.current = null
      pendingActionRef.current = null
      setAskingNodeId(null)

      if (!handleResult || !nodeId) {
        setTimeout(refetchNodes, 1000)
        return
      }

      // Always call parse-response (fetches latest assistant-message correctly)
      // For explain/simplify: use rawContent to update node content
      // For explore/examples/custom: child nodes are created from ## headings
      const isContentUpdate = action === 'explain' || action === 'simplify'
      parseResponse.mutate(
        { nodeId, issueId, skipInsert: isContentUpdate },
        {
          onSuccess: (result) => {
            // Use typeof check so empty string still triggers update
            if (isContentUpdate && typeof result.rawContent === 'string') {
              updateNode.mutate({ nodeId, content: result.rawContent })
            }
          },
          onSettled: () => setTimeout(refetchNodes, 500),
        },
      )
    }

    const fallbackTimer = setTimeout(clearLoading, 5 * 60 * 1000, false)

    const unsub = eventBus.subscribe(issueId, {
      onLog: () => {},
      onLogUpdated: () => {},
      onLogRemoved: () => {},
      onState: () => {},
      onDone: () => {
        clearTimeout(fallbackTimer)
        clearLoading(true)
      },
    })
    return () => {
      clearTimeout(fallbackTimer)
      unsub()
    }
  // parseResponse/updateNode/kanbanApi intentionally excluded — stable refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIssueId, projectId, refetchNodes])

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

  // Handle wb:ask-ai custom event from MindmapNode
  useEffect(() => {
    function handleAskAI(e: Event) {
      const { nodeId, action, prompt } = (e as CustomEvent).detail
      setAskingNodeId(nodeId)
      askAI.mutate(
        { nodeId, action, prompt },
        {
          onSuccess: (data) => {
            pendingNodeRef.current = nodeId
            pendingActionRef.current = action
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

  // Handle wb:generate-tree event from WhiteboardHeader
  useEffect(() => {
    function handleGenerateTree(e: Event) {
      const { topic } = (e as CustomEvent).detail as { topic: string }
      // Find or use root node; if none, create root first then ask
      const rootNode = nodes.find(n => !n.parentId)
      if (rootNode) {
        setAskingNodeId(rootNode.id)
        askAI.mutate(
          { nodeId: rootNode.id, action: 'custom', prompt: `Generate a comprehensive mindmap about: ${topic}. Use ## headings for each main subtopic, with a brief description paragraph under each.` },
          {
            onSuccess: (data) => {
              pendingNodeRef.current = rootNode.id
              pendingActionRef.current = 'explore'
              setPendingIssueId(data.issueId)
            },
            onError: () => setAskingNodeId(null),
          },
        )
      } else {
        // Create root node with the topic label, then ask
        createNode.mutate(
          { label: topic },
          {
            onSuccess: (newNode) => {
              setAskingNodeId(newNode.id)
              askAI.mutate(
                { nodeId: newNode.id, action: 'custom', prompt: `Generate a comprehensive mindmap about: ${topic}. Use ## headings for each main subtopic, with a brief description paragraph under each.` },
                {
                  onSuccess: (data) => {
                    pendingNodeRef.current = newNode.id
                    pendingActionRef.current = 'explore'
                    setPendingIssueId(data.issueId)
                  },
                  onError: () => setAskingNodeId(null),
                },
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
