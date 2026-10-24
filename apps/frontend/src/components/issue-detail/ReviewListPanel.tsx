import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useReviewIssues } from '@/hooks/use-kanban'
import type { Issue } from '@/types/kanban'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { STATUS_MAP } from '@/lib/statuses'
import { IssueRow, LIST_MAX_WIDTH, LIST_MIN_WIDTH, ListGroupHeader } from './IssueListPanel'

type ReviewIssue = Issue & { projectName: string, projectAlias: string }

export function ReviewListPanel({
  activeIssueId,
  width,
  onWidthChange,
  mobileNav,
}: {
  activeIssueId: string
  width?: number
  onWidthChange?: (width: number) => void
  mobileNav?: React.ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: issues, isLoading } = useReviewIssues()
  const [search, setSearch] = useState('')
  const searchTerm = search.trim().toLowerCase()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

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
          issues: [issue],
        })
      }
    }
    return [...map.values()]
  }, [filtered])

  const toggleCollapse = (projectId: string) => {
    setCollapsed(prev => ({ ...prev, [projectId]: !prev[projectId] }))
  }

  return (
    <div
      className="relative flex flex-col h-full w-full border-r border-border bg-secondary shrink-0"
      style={width ? { width: `${width}px` } : undefined}
    >
      {/* Header */}
      {/* Same height as the project list header, so the rows line up across pages */}
      <div data-slot="list-header" className="flex items-center justify-between px-2.5 py-2.5 border-b border-border/60 shrink-0 min-h-[49px] bg-secondary/50">
        <div className="flex items-center gap-1.5 min-w-0">
          {mobileNav}
          <span className="text-sm font-semibold truncate tracking-tight">{t('review.title')}</span>
          {issues
            ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground/60">
                  (
                  {issues.length}
                  )
                </span>
              )
            : null}
        </div>
      </div>

      {/* Search */}
      <div className="px-2.5 py-1.5">
        <div className="group flex items-center gap-2 rounded-lg bg-card/80 border border-transparent px-2.5 py-1.5 transition-all duration-200 focus-within:border-primary/30 focus-within:bg-card focus-within:shadow-sm">
          <Search className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 transition-colors group-focus-within:text-primary/60" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="flex-1 bg-transparent text-base md:text-xs outline-none placeholder:text-muted-foreground/40"
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
                    projectId={group.projectId}
                    issues={group.issues}
                    isCollapsed={!!collapsed[group.projectId]}
                    onToggle={() => toggleCollapse(group.projectId)}
                    activeIssueId={activeIssueId}
                    onNavigate={(projectId, issueId) => navigate(`/review/${projectId}/${issueId}`)}
                    onActiveDeleted={() => navigate('/review')}
                  />
                ))
              )}
      </div>

      {/* Resize handle */}
      {onWidthChange && width ?
          (
            <ResizeHandle
              edge="right"
              width={width}
              onWidthChange={onWidthChange}
              min={LIST_MIN_WIDTH}
              max={LIST_MAX_WIDTH}
              label={t('issue.resizeListPanel')}
            />
          ) :
        null}
    </div>
  )
}

/** Review status colour, so project groups read like the review status group. */
const REVIEW_COLOR = STATUS_MAP.get('review')?.color ?? '#f59e0b'

function ProjectGroup({
  projectName,
  projectId,
  issues,
  isCollapsed,
  onToggle,
  activeIssueId,
  onNavigate,
  onActiveDeleted,
}: {
  projectName: string
  projectId: string
  issues: ReviewIssue[]
  isCollapsed: boolean
  onToggle: () => void
  activeIssueId: string
  onNavigate: (projectId: string, issueId: string) => void
  onActiveDeleted: () => void
}) {
  return (
    <div>
      <ListGroupHeader color={REVIEW_COLOR} label={projectName} count={issues.length} collapsed={isCollapsed} onToggle={onToggle} />
      {!isCollapsed
        ? (
            <div>
              {issues.map(issue => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  projectId={projectId}
                  isActive={issue.id === activeIssueId}
                  onNavigate={issueId => onNavigate(projectId, issueId)}
                  onActiveDeleted={onActiveDeleted}
                />
              ))}
            </div>
          )
        : null}
    </div>
  )
}
