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
  const parseResponse = useParseWhiteboardResponse(projectId)
  const generateIssues = useGenerateIssuesFromNodes(projectId)

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  // Spinners for nodes whose asks are in-flight. Derived from askingCountsRef
  // below — counts (not a Set) so multiple concurrent asks on the same node
  // each track independently and a single completion/error only clears one.
  const [askingNodeIds, setAskingNodeIds] = useState<Set<string>>(new Set())
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [generatedItems, setGeneratedItems] = useState<GeneratedIssueItem[]>([])
  const [chatPanelOpen, setChatPanelOpen] = useState(false)
  const pendingGenerateNodeIds = useRef<string[]>([])
  // In-flight whiteboard asks awaiting SSE `done`. Keyed by executionId so
  // unrelated `done` events on the same bound issue (e.g. user chatting in
  // the IssuePanel) don't dequeue a whiteboard ask and attach stray output
  // to a random node.
  const pendingAsksRef = useRef<Array<{ executionId: string, nodeId: string }>>([])
  // Counts so same-node asks track independently: dropping one error must
  // not hide the spinner for a still-pending sibling ask on that node.
  const askingCountsRef = useRef<Map<string, number>>(new Map())

  const syncAskingState = useCallback(() => {
    setAskingNodeIds(new Set(askingCountsRef.current.keys()))
  }, [])

  const incAsking = useCallback((nodeId: string) => {
    const m = askingCountsRef.current
    m.set(nodeId, (m.get(nodeId) ?? 0) + 1)
    syncAskingState()
  }, [syncAskingState])

  const decAsking = useCallback((nodeId: string) => {
    const m = askingCountsRef.current
    const cur = m.get(nodeId) ?? 0
    if (cur <= 1) m.delete(nodeId)
    else m.set(nodeId, cur - 1)
    syncAskingState()
  }, [syncAskingState])

  const trackAsk = useCallback((executionId: string | undefined, nodeId: string) => {
    if (!executionId) return
    pendingAsksRef.current = [...pendingAsksRef.current, { executionId, nodeId }]
  }, [])

  // Derive the bound issue ID from the root node
  const boundIssueId = useMemo(() => {
    const root = nodes.find(n => !n.parentId)
    return root?.boundIssueId ?? null
  }, [nodes])

  // SSE subscription on the bound whiteboard issue — when a turn finishes,
  // parse the AI's markdown reply into child nodes under the focal node, then
  // refetch. Without this call the AI's response never materializes as nodes.
  useEffect(() => {
    if (!boundIssueId) return

    const parseTimers = new Set<ReturnType<typeof setTimeout>>()
    const unsub = eventBus.subscribe(boundIssueId, {
      onLog: () => {},
      onLogUpdated: () => {},
      onLogRemoved: () => {},
      onState: () => {},
      onDone: ({ executionId, finalStatus }) => {
        // The bound whiteboard issue also serves as the chat panel's session,
        // so every turn on this issue emits `done` — including non-whiteboard
        // chat replies. Look up the originating ask by executionId; if this
        // completion wasn't triggered by a whiteboard ask, ignore it.
        const queue = pendingAsksRef.current
        const idx = queue.findIndex(p => p.executionId === executionId)
        if (idx === -1) return
        const { nodeId: parentNodeId } = queue[idx]
        pendingAsksRef.current = [...queue.slice(0, idx), ...queue.slice(idx + 1)]
        decAsking(parentNodeId)
        // Only parse on successful turns — failed/cancelled turns have no
        // fresh assistant message and would otherwise make /parse-response
        // fall back to a prior reply, inserting stale headings under the
        // focal node.
        if (finalStatus !== 'completed') {
          refetchNodes()
          return
        }
        // Small delay so the final assistant-message row is flushed before we
        // ask the server to parse it. Timer is tracked in parseTimers and
        // cleared on unmount (see return cleanup below).
        // eslint-disable-next-line react-web-api/no-leaked-timeout
        const timer = setTimeout(() => {
          parseTimers.delete(timer)
          parseResponse.mutate(
            { nodeId: parentNodeId, issueId: boundIssueId },
            { onSettled: () => refetchNodes() },
          )
        }, 500)
        parseTimers.add(timer)
      },
    })
    return () => {
      for (const t of parseTimers) clearTimeout(t)
      parseTimers.clear()
      unsub()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundIssueId, decAsking])

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
      incAsking(nodeId)
      askAI.mutate(
        { nodeId, prompt },
        {
          onSuccess: ({ executionId }) => trackAsk(executionId, nodeId),
          onError: () => decAsking(nodeId),
        },
      )
    }
    window.addEventListener('wb:ask-ai', handleAskAI)
    return () => window.removeEventListener('wb:ask-ai', handleAskAI)
  }, [askAI, incAsking, decAsking, trackAsk])

  // Handle wb:generate-tree event from WhiteboardHeader
  useEffect(() => {
    function handleGenerateTree(e: Event) {
      const { topic } = (e as CustomEvent).detail as { topic: string }
      const treePrompt = `Generate a comprehensive mindmap about: ${topic}. Output 3-7 top-level subtopics as markdown "## headings"; the paragraph under each heading becomes that subtopic's content.`
      const rootNode = nodes.find(n => !n.parentId)
      if (rootNode) {
        incAsking(rootNode.id)
        askAI.mutate(
          { nodeId: rootNode.id, prompt: treePrompt },
          {
            onSuccess: ({ executionId }) => trackAsk(executionId, rootNode.id),
            onError: () => decAsking(rootNode.id),
          },
        )
      } else {
        // Create root with the topic label, then ask
        createNode.mutate(
          { label: topic },
          {
            onSuccess: (newNode) => {
              incAsking(newNode.id)
              askAI.mutate(
                { nodeId: newNode.id, prompt: treePrompt },
                {
                  onSuccess: ({ executionId }) => trackAsk(executionId, newNode.id),
                  onError: () => decAsking(newNode.id),
                },
              )
            },
          },
        )
      }
    }
    window.addEventListener('wb:generate-tree', handleGenerateTree)
    return () => window.removeEventListener('wb:generate-tree', handleGenerateTree)
  }, [askAI, createNode, nodes, incAsking, decAsking, trackAsk])

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
            askingNodeIds={askingNodeIds}
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
