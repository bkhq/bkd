import { cn } from 'cn'
import { Pin } from 'lucide-react'
import { memo } from 'react'
import { IssueContextMenu, IssueContextMenuButton, IssueRightClickMenu } from '@/components/issue-detail/IssueContextMenu'
import type { Issue } from '@/types/kanban'

export const KanbanCard = memo(({
  issue,
  projectId,
  isSelected,
  onCardClick,
}: {
  issue: Issue
  projectId: string
  isSelected?: boolean
  onCardClick?: (issue: Issue) => void
}) => {
  return (
    <div
      role="button"
      tabIndex={0}
      // Menus and dialogs are portaled but still bubble here through the React tree.
      onClick={(e) => {
        if (e.currentTarget.contains(e.target as Node)) onCardClick?.(issue)
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onCardClick?.(issue)
        }
      }}
      className="group relative cursor-grab outline-none active:cursor-grabbing"
    >
      {/* Right-click area: the whole card but the "..." button, which must stay outside the context menu. */}
      <IssueRightClickMenu issue={issue} projectId={projectId} showPin className="block">
        <KanbanCardSurface issue={issue} isSelected={isSelected} />
      </IssueRightClickMenu>
      <div
        className="absolute right-2.5 top-2.5 opacity-0 transition-opacity group-hover:opacity-100 has-data-popup-open:opacity-100"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        <IssueContextMenu issue={issue} projectId={projectId} showPin>
          <IssueContextMenuButton />
        </IssueContextMenu>
      </div>
    </div>
  )
})

/** The card's look, shared by the card in its column and the lifted copy that follows the pointer. */
export function KanbanCardSurface({ issue, isSelected = false, isOverlay = false }: {
  issue: Issue
  isSelected?: boolean
  isOverlay?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-md bg-background px-3 py-2.5 ring-1 transition-shadow',
        isOverlay
          ? 'shadow-lg shadow-foreground/10 ring-foreground/20'
          : isSelected
            ? 'ring-primary/50'
            : 'ring-border/60 hover:ring-foreground/20',
      )}
    >
      {/* Issue number; the "..." button is laid over the right end of this row by KanbanCard. */}
      <div className="mb-1 flex h-[18px] items-center">
        <span className="font-mono text-[11px] font-medium text-muted-foreground">
          {issue.isPinned && <Pin className="mr-0.5 -mt-0.5 inline size-2.5 text-primary" />}
          #
          {issue.issueNumber}
        </span>
      </div>

      {/* Title */}
      <p className="text-sm font-medium leading-snug text-foreground">{issue.title}</p>

      {/* Tags */}
      {issue.tags && issue.tags.length > 0
        ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {issue.tags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )
        : null}
    </div>
  )
}
