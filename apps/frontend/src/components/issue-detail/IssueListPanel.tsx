import {
  Activity,
  ChevronRight,
  FolderOpen,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  Settings,
} from 'lucide-react'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { IssueContextMenu, IssueRightClickMenu } from '@/components/issue-detail/IssueContextMenu'
import { IssueMessageMatches } from '@/components/issue-detail/IssueMessageMatches'
import { ProjectSettingsDialog } from '@/components/ProjectSettingsDialog'
import { Button } from '@/components/ui/button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { useIssues, useProject } from '@/hooks/use-kanban'
import { tStatus } from '@/lib/i18n-utils'
import type { GroupedIssues } from '@/lib/issue-order'
import { groupIssuesByRecent } from '@/lib/issue-order'
import type { StatusDefinition } from '@/lib/statuses'
import { STATUSES } from '@/lib/statuses'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { usePanelStore } from '@/stores/panel-store'
import { useProcessManagerStore } from '@/stores/process-manager-store'
import type { Issue } from '@/types/kanban'

/** Width bounds for the issue list column, shared with the pages that own its width. */
export const LIST_MIN_WIDTH = 180
export const LIST_MAX_WIDTH = 400

export function IssueListPanel({
  projectId,
  activeIssueId,
  projectName,
  width,
  onWidthChange,
  mobileNav,
}: {
  projectId: string
  activeIssueId: string
  projectName: string
  width?: number
  onWidthChange?: (width: number) => void
  mobileNav?: React.ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: issues } = useIssues(projectId)
  const { data: project } = useProject(projectId)
  const openCreateDialog = usePanelStore(s => s.openCreateDialog)
  const toggleFileBrowser = useFileBrowserStore(s => s.toggleDrawer)
  const toggleProcessManager = useProcessManagerStore(s => s.toggle)
  const [search, setSearch] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const searchTerm = search.trim().toLowerCase()

  // The API's order: pinned, then latest status change.
  const byStatus = useMemo(() => groupIssuesByRecent(issues ?? []), [issues])

  const visibleByStatus = useMemo(() => {
    if (!searchTerm) return byStatus
    const filtered: GroupedIssues = {}
    for (const status of STATUSES)
      filtered[status.id] = (byStatus[status.id] ?? []).filter(issue => issue.title.toLowerCase().includes(searchTerm))
    return filtered
  }, [byStatus, searchTerm])
  const filteredIds = useMemo(
    () => new Set(Object.values(visibleByStatus).flat().map(issue => issue.id)),
    [visibleByStatus],
  )

  const toggleCollapse = (statusId: string) => {
    setCollapsed(prev => ({ ...prev, [statusId]: !prev[statusId] }))
  }

  return (
    <div
      className="relative flex flex-col h-full w-full border-r border-border bg-secondary shrink-0"
      style={width ? { width: `${width}px` } : undefined}
    >
      {/* Header */}
      <div data-slot="list-header" className="flex items-center justify-between px-2.5 py-2.5 border-b border-border/60 shrink-0 min-h-[49px] bg-secondary/50">
        <div className="flex items-center gap-1.5 min-w-0">
          {mobileNav}
          <span className="text-sm font-semibold truncate tracking-tight">{projectName}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setShowSettings(true)}
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
          {project?.directory && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground hover:text-foreground"
              onClick={() => toggleFileBrowser(projectId, project?.directory ?? undefined)}
              aria-label={t('viewMode.files')}
              title={t('viewMode.files')}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground hover:text-foreground"
            onClick={() => toggleProcessManager()}
            aria-label={t('processManager.title')}
            title={t('processManager.title')}
          >
            <Activity className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:h-7 md:w-7 text-muted-foreground hover:text-foreground"
            onClick={() => openCreateDialog()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
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

      {project ?
          (
            <ProjectSettingsDialog
              open={showSettings}
              onOpenChange={setShowSettings}
              project={project}
            />
          ) :
        null}

      {/* Grouped issue list */}
      <div className="flex-1 overflow-y-auto">
        {issues && STATUSES.map(status => (
          <StatusGroup
            key={status.id}
            status={status}
            issues={visibleByStatus[status.id] ?? []}
            projectId={projectId}
            isCollapsed={!!collapsed[status.id]}
            onToggle={() => toggleCollapse(status.id)}
            activeIssueId={activeIssueId}
            onNavigate={issueId => navigate(`/projects/${projectId}/issues/${issueId}`)}
            onActiveDeleted={() => navigate(`/projects/${projectId}/issues`)}
          />
        ))}
        <IssueMessageMatches
          projectId={projectId}
          query={search.trim()}
          excludeIds={filteredIds}
          onNavigate={issueId => navigate(`/projects/${projectId}/issues/${issueId}`)}
        />
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

/**
 * Sticky, collapsible group bar of an issue list (status groups here, project
 * groups in the review queue). Opaque base so rows cannot show through.
 */
export function ListGroupHeader({ color, label, count, collapsed, onToggle, action }: {
  color: string
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
  action?: React.ReactNode
}) {
  return (
    <div
      className="group/head sticky top-0 z-10 flex h-8 items-center gap-1.5 border-b border-border/20 bg-secondary px-2.5 text-xs"
      style={{ backgroundImage: `linear-gradient(${color}14, ${color}14)` }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-0.5 text-left transition-colors hover:text-foreground"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate font-semibold tracking-tight text-foreground/85">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground/60">
          (
          {count}
          )
        </span>
      </button>
      {action}
    </div>
  )
}

export function StatusGroup({
  status,
  issues,
  projectId,
  isCollapsed,
  onToggle,
  activeIssueId,
  onNavigate,
  onActiveDeleted,
}: {
  status: StatusDefinition
  issues: Issue[]
  projectId: string
  isCollapsed: boolean
  onToggle: () => void
  activeIssueId: string
  onNavigate: (issueId: string) => void
  onActiveDeleted: () => void
}) {
  const { t } = useTranslation()
  const openCreateDialog = usePanelStore(s => s.openCreateDialog)
  const canCreate = status.id === 'todo' || status.id === 'working'

  return (
    <div>
      <ListGroupHeader
        color={status.color}
        label={tStatus(t, status.name)}
        count={issues.length}
        collapsed={isCollapsed}
        onToggle={onToggle}
        action={canCreate
          ? (
              <button
                type="button"
                onClick={() => openCreateDialog(status.id)}
                aria-label={t('kanban.createIssueIn', { name: tStatus(t, status.name) })}
                title={t('kanban.createIssueIn', { name: tStatus(t, status.name) })}
                className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-background/60 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )
          : null}
      />

      {!isCollapsed ? (
        <div>
          {issues.map(issue => (
            <IssueRow
              key={issue.id}
              issue={issue}
              projectId={projectId}
              isActive={issue.id === activeIssueId}
              onNavigate={onNavigate}
              onActiveDeleted={onActiveDeleted}
            />
          ))}
          {issues.length === 0 ?
              (
                <div className="px-2 py-3 min-h-[44px] flex items-center justify-center">
                  <span className="text-[11px] text-muted-foreground/55 text-center pointer-events-none">
                    {t('issue.emptyStatusHint')}
                  </span>
                </div>
              ) :
            null}
        </div>
      ) : null}
    </div>
  )
}

export const IssueRow = memo(({
  issue,
  projectId,
  isActive,
  onNavigate,
  onActiveDeleted,
}: {
  issue: Issue
  projectId: string
  isActive: boolean
  onNavigate: (issueId: string) => void
  onActiveDeleted: () => void
}) => {
  const handleClick = useCallback(() => {
    if (!isActive) {
      onNavigate(issue.id)
    }
  }, [isActive, issue.id, onNavigate])

  return (
    <div
      role="button"
      tabIndex={0}
      // Menus and dialogs are portaled but still bubble here through the React tree.
      onClick={(e) => {
        if (e.currentTarget.contains(e.target as Node)) handleClick()
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      className={`group w-full flex items-center gap-1.5 px-2.5 py-2.5 md:py-1.5 text-left transition-colors duration-150 ${
        isActive ? 'bg-primary/[0.08] cursor-default' : 'hover:bg-accent/60 cursor-pointer'
      }`}
    >
      {/* Right-click area: everything but the "..." button, which must stay outside the context menu. */}
      <IssueRightClickMenu
        issue={issue}
        projectId={projectId}
        showPin
        onDeleted={isActive ? onActiveDeleted : undefined}
        className="contents"
      >
        <span
          className={`text-[11px] font-mono shrink-0 tabular-nums ${
            isActive ? 'text-primary font-medium' : 'text-muted-foreground/70'
          }`}
        >
          #
          {issue.issueNumber}
        </span>
        {issue.isPinned && <Pin className="size-3 shrink-0 text-primary" />}
        <span
          title={issue.title}
          className={`flex-1 min-w-0 text-[13px] truncate ${
            isActive ? 'text-foreground font-medium' : 'text-foreground/90'
          }`}
        >
          {issue.title}
        </span>
      </IssueRightClickMenu>
      <div className="opacity-0 group-hover:opacity-100 has-data-popup-open:opacity-100 transition-opacity shrink-0" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <IssueContextMenu
          issue={issue}
          projectId={projectId}
          showPin
          onDeleted={isActive ? onActiveDeleted : undefined}
        >
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </IssueContextMenu>
      </div>
    </div>
  )
})
