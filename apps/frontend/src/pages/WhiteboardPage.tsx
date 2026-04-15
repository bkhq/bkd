import { useCallback, useEffect, useRef, useState } from 'react'
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

interface GeneratedIssueItem {
  nodeId: string
  title: string
  prompt: string
}

export default function WhiteboardPage() {
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
  // pendingParses tracks nodeId per issueId so concurrent asks don't overwrite each other
  const pendingParsesRef = useRef(new Map<string, string>())
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [generatedItems, setGeneratedItems] = useState<GeneratedIssueItem[]>([])
  // Track selected node IDs for generate-issues (last node the user right-clicked via event)
  const pendingGenerateNodeIds = useRef<string[]>([])

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

  // Subscribe to SSE for all pending whiteboard issue completions.
  // When AI completes, auto-call parse-response to create child nodes.
  useEffect(() => {
    if (!askingNodeId) return

    const parsesMap = pendingParsesRef.current
    // Find the issueId that this node is waiting on
    let activeIssueId: string | null = null
    for (const [iid, nid] of parsesMap) {
      if (nid === askingNodeId) {
        activeIssueId = iid; break
      }
    }
    if (!activeIssueId) return

    const issueId = activeIssueId

    const clearLoading = (runParse = false) => {
      const nodeId = parsesMap.get(issueId)
      parsesMap.delete(issueId)
      setAskingNodeId(null)
      if (runParse && nodeId) {
        parseResponse.mutate(
          { nodeId, issueId },
          { onSettled: () => setTimeout(refetchNodes, 500) },
        )
      } else {
        setTimeout(refetchNodes, 1000)
      }
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
  // parseResponse intentionally excluded — stable mutation ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askingNodeId, refetchNodes])

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
            pendingParsesRef.current.set(data.issueId, nodeId)
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
              pendingParsesRef.current.set(data.issueId, rootNode.id)
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
                    pendingParsesRef.current.set(data.issueId, newNode.id)
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
      <GenerateIssuesDialog
        projectId={projectId}
        items={generatedItems}
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        onCreated={(count) => {
          void count
          setGenerateDialogOpen(false)
        }}
      />
    </div>
  )
}
