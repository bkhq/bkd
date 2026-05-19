import {
  Activity,
  Clock,
  Eye,
  FileSearch,
  Home,
  LayoutGrid,
  TerminalSquare,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { kanbanApi } from '@/lib/kanban-api'
import { queryKeys, useAllProcesses, useProjects, useReviewIssues } from '@/hooks/use-kanban'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useTerminalStore } from '@/stores/terminal-store'
import { useViewModeStore } from '@/stores/view-mode-store'
import { formatRelativeTime } from '@/lib/format'
import type { ProcessInfo } from '@/types/kanban'

interface QuickAction {
  id: string
  icon: LucideIcon
  label: string
  shortcut?: string
  action: () => void
}

export function SearchContent({
  onSelect,
  autoFocus = false,
}: {
  onSelect: () => void
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const { data: processesData } = useAllProcesses()
  const { data: reviewIssues } = useReviewIssues()
  const projectPath = useViewModeStore(s => s.projectPath)
  const [query, setQuery] = useState('')

  const quickActions = useMemo<QuickAction[]>(() => {
    const actions: QuickAction[] = [
      {
        id: 'home',
        icon: Home,
        label: t('search.gotoHome', '首页'),
        action: () => navigate('/'),
      },
      {
        id: 'review',
        icon: Eye,
        label: t('search.gotoReview', 'Review 页面'),
        action: () => navigate('/review'),
      },
      {
        id: 'terminal',
        icon: TerminalSquare,
        label: t('search.openTerminal', '终端'),
        action: () => useTerminalStore.getState().openFullscreen(),
      },
      {
        id: 'cron',
        icon: Clock,
        label: t('search.gotoCron', '定时任务'),
        action: () => navigate('/cron'),
      },
    ]
    return actions
  }, [navigate, t])

  const handleSelect = useCallback(
    (fn: () => void) => {
      fn()
      onSelect()
    },
    [onSelect],
  )

  const normalizedQuery = query.trim().toLowerCase()

  const filteredProcesses = useMemo(() => {
    const procs = processesData?.processes ?? []
    if (!normalizedQuery) return procs
    return procs.filter(
      p =>
        p.issueTitle.toLowerCase().includes(normalizedQuery) ||
        p.projectName.toLowerCase().includes(normalizedQuery),
    )
  }, [processesData, normalizedQuery])

  const filteredReview = useMemo(() => {
    if (!reviewIssues) return []
    if (!normalizedQuery) return reviewIssues
    return reviewIssues.filter(
      i =>
        i.title.toLowerCase().includes(normalizedQuery) ||
        i.projectName.toLowerCase().includes(normalizedQuery),
    )
  }, [reviewIssues, normalizedQuery])

  const filteredProjects = useMemo(() => {
    if (!normalizedQuery) return []
    return (projects ?? []).filter(
      p =>
        p.name.toLowerCase().includes(normalizedQuery) ||
        p.alias.toLowerCase().includes(normalizedQuery),
    )
  }, [projects, normalizedQuery])

  const filteredActions = useMemo(() => {
    if (!normalizedQuery) return quickActions
    return quickActions.filter(a => a.label.toLowerCase().includes(normalizedQuery))
  }, [quickActions, normalizedQuery])

  const hasResults =
    filteredProcesses.length > 0 ||
    filteredReview.length > 0 ||
    filteredProjects.length > 0 ||
    filteredActions.length > 0

  const showRunning = filteredProcesses.length > 0
  const showReview = filteredReview.length > 0
  const showActions = filteredActions.length > 0 && !normalizedQuery
  const showProjects = filteredProjects.length > 0
  // (logs hook below; recompute hasResults to include them)
  // FTS5 log search — only when user has typed at least 2 chars
  const logSearchEnabled = normalizedQuery.length >= 2
  const { data: logHits } = useQuery({
    queryKey: queryKeys.logSearch(normalizedQuery),
    queryFn: () => kanbanApi.searchLogs(normalizedQuery, 20),
    enabled: logSearchEnabled,
    staleTime: 5000,
  })
  const showLogs = logSearchEnabled && logHits && logHits.length > 0

  return (
    <Command className="bg-transparent" shouldFilter={false}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('search.placeholder', '搜索任务、项目...')}
        autoFocus={autoFocus}
      />
      <CommandList className="no-scrollbar">
        {!hasResults && !showLogs && normalizedQuery && (
          <CommandEmpty>{t('search.noResults', '无结果')}</CommandEmpty>
        )}

        {/* Running processes */}
        {showRunning && (
          <CommandGroup heading={t('search.running', '运行中')}>
            {filteredProcesses.map((p: ProcessInfo) => (
              <CommandItem
                key={p.issueId}
                value={`running-${p.issueId}`}
                onSelect={() =>
                  handleSelect(() =>
                    navigate(`/projects/${p.projectAlias}/issues/${p.issueId}`),
                  )}
              >
                <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-40" />
                  <Activity className="relative h-4 w-4 text-green-500" />
                </span>
                <span className="truncate">{p.issueTitle}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  #
                  {p.issueNumber}
                  {' '}
                  ·
                  {' '}
                  {p.projectName}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {showRunning && showReview && <CommandSeparator />}

        {/* Review issues — sorted by statusUpdatedAt DESC (backend) */}
        {showReview && (
          <CommandGroup heading={`${t('search.review', '待 Review')} (${filteredReview.length})`}>
            {filteredReview.map(issue => (
              <CommandItem
                key={issue.id}
                value={`review-${issue.id}`}
                onSelect={() =>
                  handleSelect(() =>
                    navigate(`/review/${issue.projectAlias}/${issue.id}`),
                  )}
              >
                <Eye className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="truncate">{issue.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {issue.projectName}
                  {' '}
                  ·
                  {' '}
                  {formatRelativeTime(issue.statusUpdatedAt)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {showReview && showActions && <CommandSeparator />}
        {!showReview && showRunning && showActions && <CommandSeparator />}

        {/* Quick Actions */}
        {showActions && (
          <CommandGroup heading={t('search.quickActions', '快捷操作')}>
            {filteredActions.map(action => (
              <CommandItem
                key={action.id}
                value={`action-${action.id}`}
                onSelect={() => handleSelect(action.action)}
              >
                <action.icon className="h-4 w-4 text-muted-foreground" />
                <span>{action.label}</span>
                {action.shortcut && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {action.shortcut}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Logs — FTS5 cross-project conversation search */}
        {showLogs && (
          <>
            {(showRunning || showReview || showActions) && <CommandSeparator />}
            <CommandGroup heading={`${t('search.logs', '日志')} (${logHits!.length})`}>
              {logHits!.map(hit => (
                <CommandItem
                  key={hit.logId}
                  value={`log-${hit.logId}`}
                  onSelect={() =>
                    handleSelect(() =>
                      navigate(`/review/${hit.projectAlias}/${hit.issueId}`),
                    )}
                  className="items-start"
                >
                  <FileSearch className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="truncate text-sm">{hit.issueTitle}</span>
                    <span className="text-[11px] text-muted-foreground/80 line-clamp-2 break-words">
                      {hit.content}
                    </span>
                  </div>
                  <span className="ml-2 shrink-0 text-[10px] font-mono text-muted-foreground/60 self-start mt-1">
                    {hit.projectAlias}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Projects — only when filtering */}
        {showProjects && (
          <>
            {(showRunning || showReview || showActions || showLogs) && <CommandSeparator />}
            <CommandGroup heading={t('search.projects', '项目')}>
              {filteredProjects.map(project => (
                <CommandItem
                  key={project.id}
                  value={`project-${project.id}`}
                  onSelect={() =>
                    handleSelect(() => navigate(projectPath(project.alias)))}
                >
                  <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{project.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-mono text-muted-foreground/60">
                    {project.alias}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  )
}
