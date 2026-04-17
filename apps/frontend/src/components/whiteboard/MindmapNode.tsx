import { Handle, NodeToolbar, Position } from '@xyflow/react'
import { ChevronRight, ListTodo, Plus, Trash2 } from 'lucide-react'
import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownContent } from '@/components/issue-detail/MarkdownContent'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AskAIPopover } from './AskAIPopover'

interface MindmapNodeData {
  id: string
  label: string
  content: string
  icon: string | null
  hasChildren: boolean
  isCollapsed: boolean
  childCount: number
  parentId: string | null
  parentLabel: string | null
  childLabels: string[]
  askingNodeIds: Set<string>
  [key: string]: unknown
}

interface MindmapNodeProps {
  data: MindmapNodeData
  selected: boolean
}

export const MindmapNode = memo(({ data, selected }: MindmapNodeProps) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [editLabel, setEditLabel] = useState(data.label)
  const [isEditingContent, setIsEditingContent] = useState(false)
  const [editContent, setEditContent] = useState(data.content)

  // Auto-enter label edit mode when `wb:focus-node-label` targets this node.
  // Dispatched by WhiteboardPage after creating a new empty-label child so
  // the user can type immediately instead of double-clicking to edit.
  useEffect(() => {
    function handleFocus(e: Event) {
      const { nodeId } = (e as CustomEvent).detail as { nodeId: string }
      if (nodeId === data.id) {
        setEditLabel(data.label)
        setIsEditing(true)
      }
    }
    window.addEventListener('wb:focus-node-label', handleFocus)
    return () => window.removeEventListener('wb:focus-node-label', handleFocus)
  }, [data.id, data.label])

  const onLabelBlur = useCallback(() => {
    setIsEditing(false)
    if (editLabel !== data.label) {
      window.dispatchEvent(new CustomEvent('wb:update-node', {
        detail: { nodeId: data.id, label: editLabel },
      }))
    }
  }, [data.id, data.label, editLabel])

  const onLabelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.target as HTMLInputElement).blur()
    }
    if (e.key === 'Escape') {
      setEditLabel(data.label)
      setIsEditing(false)
    }
  }, [data.label])

  const onAddChild = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('wb:add-child', {
      detail: { parentId: data.id },
    }))
  }, [data.id])

  const onToggleCollapse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('wb:toggle-collapse', {
      detail: { nodeId: data.id, isCollapsed: !data.isCollapsed },
    }))
  }, [data.id, data.isCollapsed])

  const onDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('wb:delete-node', {
      detail: { nodeId: data.id },
    }))
  }, [data.id])

  const onContentBlur = useCallback(() => {
    setIsEditingContent(false)
    if (editContent !== data.content) {
      window.dispatchEvent(new CustomEvent('wb:update-node', {
        detail: { nodeId: data.id, content: editContent },
      }))
    }
  }, [data.id, data.content, editContent])

  const onContentKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditContent(data.content)
      setIsEditingContent(false)
    }
  }, [data.content])

  const onAskAI = useCallback((nodeId: string, prompt: string) => {
    window.dispatchEvent(new CustomEvent('wb:ask-ai', {
      detail: { nodeId, prompt },
    }))
  }, [])

  const onGenerateIssues = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('wb:generate-issues', {
      detail: { nodeIds: [data.id] },
    }))
  }, [data.id])

  return (
    <div className="group relative">
      {/* Card — content only, no toolbar */}
      <div
        className={cn(
          'relative rounded-lg border bg-card px-4 py-3 shadow-sm transition-shadow',
          'w-[360px]',
          !data.parentId && 'border-primary/30 bg-primary/[0.03]',
          selected && 'ring-2 ring-primary shadow-md',
        )}
      >
        {/* Handles — xyflow uses these as edge connection points */}
        {data.parentId !== null && (
          <Handle
            type="target"
            position={Position.Left}
            className="!w-2 !h-2 !bg-muted-foreground/40 !border-none"
          />
        )}
        <Handle
          type="source"
          position={Position.Right}
          className="!w-2 !h-2 !bg-muted-foreground/40 !border-none"
        />

        {/* Header */}
        <div className="flex items-center gap-2">
          {data.icon && <span className="text-base shrink-0">{data.icon}</span>}
          {isEditing
            ? (
                <input
                  className="nodrag flex-1 bg-transparent text-sm font-semibold outline-none border-b border-primary"
                  value={editLabel}
                  onChange={e => setEditLabel(e.target.value)}
                  onBlur={onLabelBlur}
                  onKeyDown={onLabelKeyDown}
                  autoFocus
                />
              )
            : (
                <span
                  className="nodrag flex-1 text-sm font-semibold cursor-text"
                  onDoubleClick={() => setIsEditing(true)}
                >
                  {data.label || t('whiteboard.untitled')}
                </span>
              )}
        </div>

        {/* Content area — markdown rendering or edit textarea.
            Uses double-click to enter edit mode (consistent with label editing)
            so that single clicks on links, tables, or text selection in the
            rendered markdown don't drop the user into a textarea by accident. */}
        {isEditingContent
          ? (
              <textarea
                className="nodrag mt-2 w-full resize-none bg-transparent text-xs text-muted-foreground outline-none border rounded px-2 py-1 min-h-[56px]"
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                onBlur={onContentBlur}
                onKeyDown={onContentKeyDown}
                autoFocus
              />
            )
          : data.content
            ? (
                <div
                  className="nodrag mt-2 text-xs text-muted-foreground cursor-text prose prose-xs dark:prose-invert max-w-none [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_th]:py-1 [&_td]:py-1"
                  onDoubleClick={() => {
                    setIsEditingContent(true); setEditContent(data.content)
                  }}
                  title={t('whiteboard.editContent')}
                >
                  <MarkdownContent content={data.content} className="text-xs leading-[1.6]" />
                </div>
              )
            : (
                <p
                  className="nodrag mt-2 text-xs text-muted-foreground/40 cursor-text"
                  onDoubleClick={() => {
                    setIsEditingContent(true); setEditContent(data.content)
                  }}
                >
                  {t('whiteboard.contentPlaceholder')}
                </p>
              )}
      </div>

      {/* Floating toolbar — xyflow NodeToolbar renders to viewport, not clipped by siblings */}
      <NodeToolbar
        isVisible={selected}
        position={Position.Bottom}
        offset={8}
        className="nodrag flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-1 shadow-md"
      >
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={onAddChild} title={t('whiteboard.addChild')}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <AskAIPopover
          nodeId={data.id}
          nodeLabel={data.label}
          parentLabel={data.parentLabel ?? undefined}
          childLabels={data.childLabels}
          isLoading={data.askingNodeIds.has(data.id)}
          onAsk={onAskAI}
        />
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={onGenerateIssues} title={t('whiteboard.generateIssues')}>
          <ListTodo className="h-3.5 w-3.5" />
        </Button>
        {data.parentId !== null && (
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-destructive hover:text-destructive" onClick={onDelete} title={t('whiteboard.delete')}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </NodeToolbar>

      {/* Collapse badge — always visible, positioned on the right edge */}
      {data.hasChildren && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className={cn(
            'nodrag absolute -right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5',
            'rounded-full border bg-background px-1.5 py-0.5 text-xs text-muted-foreground',
            'hover:bg-accent hover:text-foreground transition-colors shadow-sm',
            data.isCollapsed && 'border-primary/40 text-primary',
          )}
          title={data.isCollapsed ? t('whiteboard.expand') : t('whiteboard.collapse')}
        >
          <span className="tabular-nums font-medium">{data.childCount}</span>
          <ChevronRight className={cn(
            'h-3 w-3 transition-transform',
            !data.isCollapsed && 'rotate-90',
          )}
          />
        </button>
      )}
    </div>
  )
})
