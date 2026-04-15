import { Handle, Position } from '@xyflow/react'
import { ChevronRight, ListTodo, Plus, Trash2 } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  parentId: string | null
  parentLabel: string | null
  childLabels: string[]
  askingNodeId: string | null
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

  const onLabelBlur = useCallback(() => {
    setIsEditing(false)
    if (editLabel !== data.label) {
      // Dispatch custom event for parent to handle
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

  const onAskAI = useCallback((nodeId: string, action: string, prompt?: string) => {
    window.dispatchEvent(new CustomEvent('wb:ask-ai', {
      detail: { nodeId, action, prompt },
    }))
  }, [])

  const onGenerateIssues = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    window.dispatchEvent(new CustomEvent('wb:generate-issues', {
      detail: { nodeIds: [data.id] },
    }))
  }, [data.id])

  return (
    <div
      className={cn(
        'rounded-lg border bg-card px-4 py-3 shadow-sm transition-shadow',
        'min-w-[200px] max-w-[320px]',
        selected && 'ring-2 ring-primary shadow-md',
      )}
    >
      {/* Handles */}
      {data.parentId !== null && (
        <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-muted-foreground/50" />
      )}
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-muted-foreground/50" />

      {/* Header */}
      <div className="flex items-center gap-2">
        {data.icon && <span className="text-base shrink-0">{data.icon}</span>}
        {isEditing
          ? (
              <input
                className="flex-1 bg-transparent text-sm font-medium outline-none border-b border-primary"
                value={editLabel}
                onChange={e => setEditLabel(e.target.value)}
                onBlur={onLabelBlur}
                onKeyDown={onLabelKeyDown}
                autoFocus
              />
            )
          : (
              <span
                className="flex-1 text-sm font-medium cursor-text truncate"
                onDoubleClick={() => setIsEditing(true)}
              >
                {data.label || t('whiteboard.untitled')}
              </span>
            )}
      </div>

      {/* Content area — click to edit */}
      {isEditingContent
        ? (
            <textarea
              className="mt-1.5 w-full resize-none bg-transparent text-xs text-muted-foreground outline-none border rounded px-1 py-0.5 min-h-[56px]"
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              onBlur={onContentBlur}
              onKeyDown={onContentKeyDown}
              autoFocus
            />
          )
        : (
            <p
              className="mt-1.5 text-xs text-muted-foreground line-clamp-3 cursor-text min-h-[1rem]"
              onClick={() => {
                setIsEditingContent(true); setEditContent(data.content)
              }}
              title={t('whiteboard.editContent')}
            >
              {data.content || <span className="opacity-40">{t('whiteboard.contentPlaceholder')}</span>}
            </p>
          )}

      {/* Toolbar */}
      <div
        className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ opacity: selected ? 1 : undefined }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onAddChild}
          title={t('whiteboard.addChild')}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <AskAIPopover
          nodeId={data.id}
          nodeLabel={data.label}
          parentLabel={data.parentLabel ?? undefined}
          childLabels={data.childLabels}
          isLoading={data.askingNodeId === data.id}
          onAsk={onAskAI}
        />
        {data.hasChildren && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onToggleCollapse}
            title={data.isCollapsed ? t('whiteboard.expand') : t('whiteboard.collapse')}
          >
            <ChevronRight className={cn(
              'h-3.5 w-3.5 transition-transform',
              !data.isCollapsed && 'rotate-90',
            )}
            />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onGenerateIssues}
          title={t('whiteboard.generateIssues')}
        >
          <ListTodo className="h-3.5 w-3.5" />
        </Button>
        {data.parentId !== null && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={onDelete}
            title={t('whiteboard.delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
})
