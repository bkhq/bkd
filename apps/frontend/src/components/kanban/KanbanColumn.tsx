import { cn } from 'cn'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SortableIssues, useIssueDropGroup } from '@/components/issue-drag/IssueDragContext'
import { tStatus } from '@/lib/i18n-utils'
import type { StatusDefinition } from '@/lib/statuses'
import { usePanelStore } from '@/stores/panel-store'
import type { Issue } from '@/types/kanban'
import { KanbanCard } from './KanbanCard'

export function KanbanColumn({
  status,
  issues,
  projectId,
  selectedIssueId,
  onCardClick,
}: {
  status: StatusDefinition
  issues: Issue[]
  projectId: string
  selectedIssueId?: string | null
  onCardClick?: (issue: Issue) => void
}) {
  const { t } = useTranslation()
  const openCreateDialog = usePanelStore(s => s.openCreateDialog)
  const { setNodeRef, isTarget, slot } = useIssueDropGroup(status.id)
  // New work starts as todo or working; nobody creates an issue already in review or done.
  const canCreate = status.id === 'todo' || status.id === 'working'
  const label = tStatus(t, status.name)

  return (
    <section
      aria-label={label}
      className={cn(
        'flex h-full min-w-[85vw] flex-1 flex-col rounded-lg bg-secondary/40 ring-1 ring-transparent transition-shadow snap-center md:min-w-[260px] md:snap-align-none',
        isTarget && 'ring-foreground/20',
      )}
    >
      <header className="flex h-10 items-center gap-2 px-3">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          (
          {issues.length}
          )
        </span>
        {canCreate
          ? (
              <button
                type="button"
                onClick={() => openCreateDialog(status.id)}
                aria-label={t('kanban.createIssueIn', { name: label })}
                title={t('kanban.createIssueIn', { name: label })}
                className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            )
          : null}
      </header>

      <div ref={setNodeRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-px pb-2">
        <SortableIssues status={status.id} items={issues}>
          {issue => (
            <KanbanCard
              issue={issue}
              projectId={projectId}
              isSelected={selectedIssueId === issue.id}
              onCardClick={onCardClick}
            />
          )}
        </SortableIssues>
        {issues.length === 0 && slot === null
          ? (
              <div
                className={cn(
                  'flex flex-1 items-center justify-center rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground transition-colors',
                  isTarget ? 'border-foreground/40 bg-background/60' : 'border-border/60',
                )}
              >
                {t('issue.emptyStatusHint')}
              </div>
            )
          : null}
      </div>
    </section>
  )
}
