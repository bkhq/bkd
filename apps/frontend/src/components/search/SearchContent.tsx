import {
  Activity,
  ArrowLeft,
  Clock,
  Eye,
  Home,
  LayoutGrid,
  TerminalSquare,
} from 'lucide-react'
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
import {
  useAllProcesses,
  useProjects,
  useReviewIssues,
} from '@/hooks/use-kanban'
import { useRecentIssues } from '@/hooks/use-recent-issues'
import { useTerminalStore } from '@/stores/terminal-store'
import { useViewModeStore } from '@/stores/view-mode-store'
import type { RecentIssue } from '@/hooks/use-recent-issues'
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
  const recentIssues = useRecentIssues()
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

  const filteredRecent = useMemo(() => {
    if (!normalizedQuery) return recentIssues
    return recentIssues.filter(
      r =>
        r.title.toLowerCase().includes(normalizedQuery) ||
        r.projectName.toLowerCase().includes(normalizedQuery),
    )
  }, [recentIssues, normalizedQuery])

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
    filteredRecent.length > 0 ||
    filteredProjects.length > 0 ||
    filteredActions.length > 0

  const showRunning = filteredProcesses.length > 0
  const showReview = filteredReview.length > 0
  const showRecent = filteredRecent.length > 0 && !normalizedQuery
  const showActions = filteredActions.length > 0 && !normalizedQuery
  const showProjects = filteredProjects.length > 0

  return (
    <Command className="bg-transparent" shouldFilter={false}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('search.placeholder', '搜索任务、项目...')}
        autoFocus={autoFocus}
      />
      <CommandList className="no-scrollbar">
        {!hasResults && normalizedQuery && (
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

        {/* Review issues */}
        {showReview && (
          <CommandGroup heading={t('search.review', '待 Review')}>
            {filteredReview.map(issue => (
              <CommandItem
                key={issue.id}
                value={`review-${issue.id}`}
                onSelect={() =>
                  handleSelect(() =>
                    navigate(`/review/${issue.projectAlias}/${issue.id}`),
                  )}
              >
                <Eye className="h-4 w-4 text-amber-500" />
                <span className="truncate">{issue.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  #
                  {issue.issueNumber}
                  {' '}
                  ·
                  {' '}
                  {issue.projectName}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {showReview && showRecent && <CommandSeparator />}
        {!showReview && showRunning && showRecent && <CommandSeparator />}

        {/* Recent Issues */}
        {showRecent && (
          <CommandGroup heading={t('search.recent', '最近访问')}>
            {filteredRecent.map((issue: RecentIssue) => (
              <CommandItem
                key={issue.id}
                value={`recent-${issue.id}`}
                onSelect={() =>
                  handleSelect(() =>
                    navigate(`/projects/${issue.projectAlias}/issues/${issue.id}`),
                  )}
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{issue.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  #
                  {issue.issueNumber}
                  {' '}
                  ·
                  {' '}
                  {issue.projectName}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {showRecent && showActions && <CommandSeparator />}
        {!showRecent && (showRunning || showReview) && showActions && <CommandSeparator />}

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

        {/* Projects — only when filtering */}
        {showProjects && (
          <>
            {(showRunning || showReview || showRecent || showActions) && <CommandSeparator />}
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
