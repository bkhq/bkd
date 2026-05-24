import { Activity, ChevronDown, ChevronsLeft, ChevronUp, Search } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { BulkOperationsBar } from '@/components/issue-detail/BulkOperationsBar'
import { useReviewIssues } from '@/hooks/use-kanban'
import { useReviewReadStatus } from '@/hooks/use-review-read-status'
import { useBulkSelectionStore } from '@/stores/bulk-selection-store'
import { useProcessManagerStore } from '@/stores/process-manager-store'
import type { Issue } from '@/types/kanban'

type ReviewIssue = Issue & { projectName: string, projectAlias: string }

const FILTER_STATUSES = ['todo', 'working', 'review', 'done'] as const
const STATUS_DOT_COLOR: Record<string, string> = {
  todo: '#6b7280',
  working: '#3b82f6',
  review: '#f59e0b',
  done: '#22c55e',
}

export function ReviewListPanel({
  activeIssueId,
  width,
  onResizeStart,
  mobileNav,
  statuses,
  onStatusesChange,
  headerExtra,
  onCollapse,
}: {
  activeIssueId: string
  width?: number
  onResizeStart?: (e: React.MouseEvent) => void
  mobileNav?: React.ReactNode
  statuses?: string[]
  onStatusesChange?: (next: string[]) => void
  headerExtra?: React.ReactNode
  onCollapse?: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const effectiveStatuses = statuses ?? ['review']
  const { data: issues, isLoading } = useReviewIssues(effectiveStatuses)
  const { markAsRead, isRead } = useReviewReadStatus()
  const toggleProcessManager = useProcessManagerStore(s => s.toggle)
  const [search, setSearch] = useState('')
  const searchTerm = search.trim().toLowerCase()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const selected = useBulkSelectionStore(s => s.selected)
  const toggleSelected = useBulkSelectionStore(s => s.toggle)
  const setManySelected = useBulkSelectionStore(s => s.setMany)

  const filtered = useMemo(() => {
    if (!issues) return []
    if (!searchTerm) return issues
    return issues.filter(
      issue =>
        issue.title.toLowerCase().includes(searchTerm) ||
        issue.projectName.toLowerCase().includes(searchTerm),
    )
  }, [issues, searchTerm])

  // Group by project
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        projectId: string
        projectName: string
        projectAlias: string
        issues: ReviewIssue[]
      }
    >()
    for (const issue of filtered) {
      const existing = map.get(issue.projectId)
      if (existing) {
        existing.issues.push(issue)
      } else {
        map.set(issue.projectId, {
          projectId: issue.projectId,
          projectName: issue.projectName,
          projectAlias: issue.projectAlias,
          issues: [issue],
        })
      }
    }
    return [...map.values()]
  }, [filtered])

  const toggleCollapse = (projectId: string) => {
    setCollapsed(prev => ({ ...prev, [projectId]: !prev[projectId] }))
  }

  const allExpanded = grouped.length > 0 && grouped.every(g => !collapsed[g.projectId])

  const toggleAll = () => {
    if (allExpanded) {
      const next: Record<string, boolean> = {}
      for (const g of grouped) next[g.projectId] = true
      setCollapsed(next)
    } else {
      setCollapsed({})
    }
  }

  return (
    <div
      className="relative flex flex-col h-full w-full border-r border-border bg-secondary shrink-0"
      style={width ? { width: `${width}px` } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border/60 shrink-0 min-h-[42px] bg-secondary/50">
        <div className="flex items-center gap-1.5 min-w-0">
          {mobileNav}
          <span className="text-sm font-semibold truncate tracking-tight">{t('review.title')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {grouped.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
              title={allExpanded ? t('review.collapseAll', '折叠全部') : t('review.expandAll', '展开全部')}
              aria-label={allExpanded ? t('review.collapseAll', '折叠全部') : t('review.expandAll', '展开全部')}
            >
              {allExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={toggleProcessManager}
            className="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
            aria-label={t('processManager.title')}
            title={t('processManager.title')}
          >
            <Activity className="h-3.5 w-3.5" />
          </button>
          {issues ?
              (
                <span className="text-[10px] font-medium text-muted-foreground/50 shrink-0 tabular-nums">
                  {issues.length}
                </span>
              ) :
            null}
          {onCollapse ?
              (
                <button
                  type="button"
                  data-testid="list-panel-collapse"
                  onClick={onCollapse}
                  className="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  title={t('listPanel.collapse', 'Collapse list')}
                  aria-label={t('listPanel.collapse', 'Collapse list')}
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </button>
              ) :
            null}
        </div>
      </div>

      {headerExtra ?
          (
            <div className="px-2.5 pt-2 shrink-0">{headerExtra}</div>
          ) :
        null}

      {/* Status filter chips */}
      {onStatusesChange ?
          (
            <div className="flex items-center gap-1 px-2.5 pt-1.5 flex-wrap">
              {FILTER_STATUSES.map((s) => {
                const active = effectiveStatuses.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    data-testid={`status-chip-${s}`}
                    aria-pressed={active}
                    onClick={() => {
                      const next = active ?
                          effectiveStatuses.filter(x => x !== s) :
                          [...effectiveStatuses, s]
                      // Always keep at least one selected — fall back to default
                      onStatusesChange(next.length > 0 ? next : ['review'])
                    }}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors cursor-pointer ${
                      active ?
                        'bg-primary/10 border-primary/30 text-foreground' :
                        'bg-transparent border-border/50 text-muted-foreground/70 hover:text-foreground hover:border-border'
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: STATUS_DOT_COLOR[s] }}
                    />
                    {t(`statusName.${s.charAt(0).toUpperCase()}${s.slice(1)}`, s)}
                  </button>
                )
              })}
            </div>
          ) :
        null}

      {/* Search */}
      <div className="px-2.5 py-1.5">
        <div className="group flex items-center gap-2 rounded-lg bg-card/80 border border-transparent px-2.5 py-1.5 transition-all duration-200 focus-within:border-primary/30 focus-within:bg-card focus-within:shadow-sm">
          <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 transition-colors group-focus-within:text-primary/60" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      {/* Grouped issue list by project */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ?
            (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
              </div>
            ) :
          grouped.length === 0 ?
              (
                <div className="flex items-center justify-center py-8">
                  <p className="text-xs text-muted-foreground/55">{t('review.empty')}</p>
                </div>
              ) :
              (
                grouped.map(group => (
                  <ProjectGroup
                    key={group.projectId}
                    projectName={group.projectName}
                    projectAlias={group.projectAlias}
                    issues={group.issues}
                    isCollapsed={!!collapsed[group.projectId]}
                    onToggle={() => toggleCollapse(group.projectId)}
                    activeIssueId={activeIssueId}
                    isRead={isRead}
                    markAsRead={markAsRead}
                    onNavigate={(projectAlias, issueId) => navigate(`/review/${projectAlias}/${issueId}`)}
                    selected={selected}
                    toggleSelected={toggleSelected}
                    setManySelected={setManySelected}
                  />
                ))
              )}
      </div>

      <BulkOperationsBar
        items={(issues ?? [])
          .filter(i => selected.has(i.id))
          .map(i => ({ issueId: i.id, projectId: i.projectId }))}
      />

      {/* Resize handle */}
      {onResizeStart ?
          (
            <div
              role="separator"
              onMouseDown={onResizeStart}
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-20"
            />
          ) :
        null}
    </div>
  )
}

function ProjectGroup({
  projectName,
  projectAlias,
  issues,
  isCollapsed,
  onToggle,
  activeIssueId,
  isRead,
  markAsRead,
  onNavigate,
  selected,
  toggleSelected,
  setManySelected,
}: {
  projectName: string
  projectAlias: string
  issues: ReviewIssue[]
  isCollapsed: boolean
  onToggle: () => void
  activeIssueId: string
  isRead: (issueId: string) => boolean
  markAsRead: (issueId: string) => void
  onNavigate: (projectAlias: string, issueId: string) => void
  selected: Set<string>
  toggleSelected: (id: string) => void
  setManySelected: (ids: string[], on: boolean) => void
}) {
  const reviewColor = '#f59e0b' // amber — matches review status color
  const ids = issues.map(i => i.id)
  const selectedCount = ids.filter(id => selected.has(id)).length
  const allSelected = selectedCount === ids.length && ids.length > 0
  const someSelected = selectedCount > 0 && !allSelected

  return (
    <div>
      <div
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs sticky top-0 z-10 transition-colors border-b border-border/20"
        style={{ backgroundColor: `${reviewColor}14` }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected
          }}
          onChange={() => setManySelected(ids, !allSelected)}
          aria-label={`select all ${projectName}`}
          className="h-4 w-4 cursor-pointer shrink-0"
          onClick={e => e.stopPropagation()}
        />
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 text-left"
        >
          <span
            className="h-2 w-2 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-transparent"
            style={{
              backgroundColor: reviewColor,
              boxShadow: `0 0 6px ${reviewColor}40`,
            }}
          />
          <span className="font-semibold text-foreground/80 truncate tracking-tight">
            {projectName}
          </span>
          <span className="text-[10px] font-medium text-muted-foreground/50 ml-auto shrink-0 tabular-nums">
            {selectedCount > 0 ? `${selectedCount}/` : ''}
            {issues.length}
          </span>
        </button>
      </div>

      {!isCollapsed ?
          (
            <div>
              {issues.map(issue => (
                <ReviewIssueRow
                  key={issue.id}
                  issue={issue}
                  isActive={issue.id === activeIssueId}
                  isRead={isRead(issue.id)}
                  isSelected={selected.has(issue.id)}
                  onToggleSelect={() => toggleSelected(issue.id)}
                  onNavigate={() => {
                    markAsRead(issue.id)
                    onNavigate(projectAlias, issue.id)
                  }}
                />
              ))}
            </div>
          ) :
        null}
    </div>
  )
}

const ReviewIssueRow = memo(({
  issue,
  isActive,
  isRead,
  isSelected,
  onToggleSelect,
  onNavigate,
}: {
  issue: ReviewIssue
  isActive: boolean
  isRead: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onNavigate: () => void
}) => {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onNavigate()
        }
      }}
      className={`group w-full flex items-center gap-1 px-1.5 py-2.5 md:py-1.5 text-left border-b border-border/20 transition-all duration-150 cursor-pointer ${
        isActive ? 'bg-primary/[0.06]' : 'hover:bg-accent/50'
      } ${isSelected ? 'bg-primary/[0.04]' : ''}`}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggleSelect}
        onClick={e => e.stopPropagation()}
        aria-label={`select ${issue.title}`}
        className={`h-4 w-4 shrink-0 ml-1 cursor-pointer md:opacity-0 md:group-hover:opacity-100 transition-opacity ${
          isSelected ? 'md:opacity-100' : ''
        }`}
      />
      <span
        className="w-2 h-2 rounded-full shrink-0 mr-0.5"
        style={{ backgroundColor: STATUS_DOT_COLOR[issue.statusId] ?? '#9ca3af' }}
        title={issue.statusId}
      />
      <span
        className={`text-[11px] font-mono shrink-0 tabular-nums ${
          isActive ? 'text-primary font-medium' : 'text-muted-foreground/70'
        }`}
      >
        #
        {issue.issueNumber}
      </span>
      <span
        title={issue.title}
        className={`text-[13px] truncate ${
          isActive ? 'text-foreground font-medium' : 'text-foreground/90'
        }`}
      >
        {issue.title}
      </span>
      {!isRead && (
        <span className="ml-auto h-2 w-2 rounded-full bg-destructive shrink-0" />
      )}
    </div>
  )
})
