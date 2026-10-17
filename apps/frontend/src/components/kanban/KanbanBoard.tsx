import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { IssueDragProvider } from '@/components/issue-drag/IssueDragContext'
import { useIssues } from '@/hooks/use-kanban'
import type { GroupedIssues } from '@/lib/issue-order'
import { groupIssuesByStatus } from '@/lib/issue-order'
import { STATUSES } from '@/lib/statuses'
import { useSelectedIssueId } from '@/stores/panel-store'
import type { Issue } from '@/types/kanban'
import { KanbanCardSurface } from './KanbanCard'
import { KanbanColumn } from './KanbanColumn'

export function KanbanBoard({
  projectId,
  searchQuery,
  onCardClick,
}: {
  projectId: string
  searchQuery?: string
  onCardClick?: (issue: Issue) => void
}) {
  const { t } = useTranslation()
  const { data: issues, isLoading: issuesLoading } = useIssues(projectId)
  const selectedIssueId = useSelectedIssueId()

  const columns = useMemo(() => groupIssuesByStatus(issues ?? []), [issues])

  const visibleColumns = useMemo(() => {
    const query = searchQuery?.trim().toLowerCase()
    if (!query) return columns
    const filtered: GroupedIssues = {}
    for (const status of STATUSES) {
      filtered[status.id] = (columns[status.id] ?? []).filter(
        issue =>
          issue.title.toLowerCase().includes(query)
          || issue.issueNumber.toString().includes(query),
      )
    }
    return filtered
  }, [columns, searchQuery])

  if (issuesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">{t('kanban.loadingBoard')}</div>
      </div>
    )
  }

  return (
    <IssueDragProvider
      projectId={projectId}
      columns={columns}
      visibleColumns={visibleColumns}
      renderOverlay={issue => <KanbanCardSurface issue={issue} isOverlay />}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-3 snap-x snap-mandatory md:snap-none">
        {STATUSES.map(status => (
          <KanbanColumn
            key={status.id}
            status={status}
            issues={visibleColumns[status.id] ?? []}
            projectId={projectId}
            selectedIssueId={selectedIssueId}
            onCardClick={onCardClick}
          />
        ))}
      </div>
    </IssueDragProvider>
  )
}
