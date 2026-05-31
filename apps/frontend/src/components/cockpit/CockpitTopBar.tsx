import { Activity, Check, ChevronRight, Home, LayoutGrid, Link as LinkIcon, Plus, Search, Settings } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useIssue, useProjects, useUpdateIssue } from '@/hooks/use-kanban'
import { useRecentIssues } from '@/hooks/use-recent-issues'
import { getIssueUrl } from '@/stores/server-store'
import { usePanelStore } from '@/stores/panel-store'
import { useProcessManagerStore } from '@/stores/process-manager-store'
import { useViewModeStore } from '@/stores/view-mode-store'

const LazyProjectSettings = lazy(() =>
  import('@/components/ProjectSettingsDialog').then(m => ({
    default: m.ProjectSettingsDialog,
  })),
)

/**
 * Always-visible strip at the top of the cockpit. Solves two reported pains:
 *   • "I get lost" — breadcrumb always shows where you are + 🏠 jumps back to
 *     the empty dashboard state.
 *   • "Creating a new issue is buried" — `+ New` is reachable from every
 *     cockpit state, not just the empty dashboard.
 *
 * Also surfaces the project gear (⚙️) once the user has navigated into a
 * project context so they don't have to leave the cockpit to tweak env vars
 * or system prompt.
 */
export function CockpitTopBar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectAlias, issueId } = useParams<{ projectAlias?: string, issueId?: string }>()
  const { data: projects } = useProjects()
  const recent = useRecentIssues()
  const openCreate = usePanelStore(s => s.openCreateDialog)
  const toggleProcessManager = useProcessManagerStore(s => s.toggle)
  const toggleMatrix = useViewModeStore(s => s.toggleMiniMatrix)
  const matrixCollapsed = useViewModeStore(s => s.miniMatrixCollapsed)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Resolve project + currently-open issue summary for the breadcrumb.
  // `recent` is a cheap lookup that doesn't require the issue to be the
  // active one yet; we fall back to a live useIssue() query for the
  // authoritative title (the recent cache may lag by one keystroke after
  // an inline edit) and for first-load when the issue isn't in recent yet.
  const project = projectAlias ? projects?.find(p => p.alias === projectAlias) : undefined
  const projectId = project?.id
  const { data: liveIssue } = useIssue(projectId ?? '', issueId ?? '')
  const recentIssue = issueId ? recent.find(r => r.id === issueId) : undefined
  const issue = useMemo(
    () =>
      liveIssue
        ? {
            id: liveIssue.id,
            title: liveIssue.title,
            issueNumber: liveIssue.issueNumber,
            statusId: liveIssue.statusId,
          }
        : recentIssue,
    [liveIssue, recentIssue],
  )

  // Inline title editing — replaces the click-to-edit affordance that
  // previously lived in ChatArea's title bar. Same Enter/Escape semantics.
  const updateIssue = useUpdateIssue(projectId ?? '')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const startEditingTitle = useCallback(() => {
    if (!issue || !projectId) return
    setTitleDraft(issue.title)
    setEditingTitle(true)
    requestAnimationFrame(() => titleInputRef.current?.focus())
  }, [issue, projectId])
  const saveTitle = useCallback(() => {
    if (!issue || !projectId) {
      setEditingTitle(false)
      return
    }
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== issue.title) {
      updateIssue.mutate({ id: issue.id, title: trimmed })
    }
    setEditingTitle(false)
  }, [titleDraft, issue, projectId, updateIssue])

  // Copy-link affordance — used to live on the ChatArea title bar; moved
  // here so the cockpit's single header row owns identity + actions.
  const [copied, setCopied] = useState(false)
  const copyIssueLink = useCallback(() => {
    if (!projectId || !issue) return
    navigator.clipboard
      .writeText(getIssueUrl(projectId, issue.id))
      .then(() => {
        setCopied(true)
        setTimeout(setCopied, 2000, false)
      })
      .catch(() => {})
  }, [projectId, issue])

  // ⌘N already triggers QuickCreate globally (CockpitQuickCreate listens).
  // The + button here opens the kanban-style CreateIssueDialog, passing the
  // current project context so the issue lands in the right project.
  // When no project context, the dialog shows a project selector.
  const openNew = () => openCreate(undefined, projectId)

  // Keyboard alt-arrow back/forward through recent tabs — light convenience
  // for keyboard users. ⌥← goes one back in recent (relative to current),
  // ⌥→ goes one forward.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      const idx = issueId ? recent.findIndex(r => r.id === issueId) : -1
      if (idx === -1) return
      const next = e.key === 'ArrowLeft' ? idx + 1 : idx - 1
      const target = recent[next]
      if (!target) return
      e.preventDefault()
      navigate(`/review/${target.projectAlias}/${target.id}`)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [recent, issueId, navigate])

  return (
    <div
      data-testid="cockpit-topbar"
      className="flex items-center gap-2 px-2 py-1 border-b border-border/60 bg-background/80 backdrop-blur-sm shrink-0 min-h-[34px]"
    >
      {/* Breadcrumb */}
      <button
        type="button"
        data-testid="cockpit-topbar-home"
        onClick={() => navigate('/review')}
        title={t('cockpit.topbar.home', 'Cockpit home')}
        aria-label={t('cockpit.topbar.home', 'Cockpit home')}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
      >
        <Home className="h-3.5 w-3.5" />
      </button>

      {project ?
          (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
              <button
                type="button"
                data-testid="cockpit-topbar-project"
                onClick={() => navigate(`/projects/${project.alias}`)}
                title={project.name}
                className="text-xs font-medium text-foreground/85 hover:text-primary truncate cursor-pointer"
              >
                {project.name}
              </button>
              <button
                type="button"
                data-testid="cockpit-topbar-project-settings"
                onClick={() => setSettingsOpen(true)}
                aria-label={t('cockpit.topbar.projectSettings', 'Project settings')}
                title={t('cockpit.topbar.projectSettings', 'Project settings')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <Settings className="h-3 w-3" />
              </button>
            </>
          ) :
        null}

      {issue ?
          (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
              <span className="text-[11px] font-mono tabular-nums text-muted-foreground/70 shrink-0">
                #
                {issue.issueNumber}
              </span>
              {editingTitle ?
                  (
                    <input
                      ref={titleInputRef}
                      data-testid="cockpit-topbar-title-input"
                      className="text-xs font-medium bg-transparent border-b border-primary outline-none min-w-0 flex-1 text-foreground"
                      value={titleDraft}
                      onChange={e => setTitleDraft(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveTitle()
                        } else if (e.key === 'Escape') {
                          setEditingTitle(false)
                        }
                      }}
                    />
                  ) :
                  (
                    <button
                      type="button"
                      data-testid="cockpit-topbar-title"
                      onClick={startEditingTitle}
                      title={t('issue.editTitle', 'Click to edit title')}
                      className="text-xs text-foreground/90 truncate min-w-0 flex-1 text-left hover:text-primary transition-colors cursor-text"
                    >
                      {issue.title}
                    </button>
                  )}
              <button
                type="button"
                data-testid="cockpit-topbar-copy-link"
                onClick={copyIssueLink}
                aria-label={t('issue.copyLink', 'Copy link')}
                title={t('issue.copyLink', 'Copy link')}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-all duration-200 cursor-pointer ${
                  copied
                    ? 'text-emerald-500 scale-110'
                    : 'text-muted-foreground/60 hover:bg-accent hover:text-foreground'
                }`}
              >
                {copied ? <Check className="h-3 w-3" /> : <LinkIcon className="h-3 w-3" />}
              </button>
            </>
          ) :
          (
            <span className="text-xs text-muted-foreground/60 ml-1">
              {t('cockpit.topbar.label', 'Cockpit')}
            </span>
          )}

      {/* Action cluster */}
      <div className="ml-auto flex items-center gap-1 shrink-0">
        <button
          type="button"
          data-testid="cockpit-topbar-new"
          onClick={openNew}
          aria-label={t('cockpit.topbar.new', 'New issue (⌘N)')}
          title={t('cockpit.topbar.new', 'New issue (⌘N)')}
          className="flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{t('cockpit.topbar.newShort', 'New')}</span>
        </button>
        <button
          type="button"
          data-testid="cockpit-topbar-processes"
          onClick={toggleProcessManager}
          aria-label={t('processManager.title', 'Processes')}
          title={t('processManager.title', 'Processes')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          <Activity className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-testid="cockpit-topbar-search"
          onClick={() => navigate('/search')}
          aria-label={t('cockpit.topbar.search', 'Search / jump (⌘K)')}
          title={t('cockpit.topbar.search', 'Search / jump (⌘K)')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          data-testid="cockpit-topbar-matrix"
          onClick={toggleMatrix}
          aria-pressed={!matrixCollapsed}
          aria-label={t('cockpit.topbar.matrix', 'Toggle overview matrix')}
          title={t('cockpit.topbar.matrix', 'Toggle overview matrix')}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer ${
            matrixCollapsed ?
              'text-muted-foreground hover:bg-accent hover:text-foreground' :
              'text-primary bg-primary/10 hover:bg-primary/15'
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
      </div>

      {project ?
          (
            <Suspense fallback={null}>
              <LazyProjectSettings
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                project={project}
              />
            </Suspense>
          ) :
        null}
    </div>
  )
}
