import { ChevronRight, Home, LayoutGrid, Plus, Search, Settings } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { useProjects } from '@/hooks/use-kanban'
import { useRecentIssues } from '@/hooks/use-recent-issues'
import { usePanelStore } from '@/stores/panel-store'
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
  const toggleMatrix = useViewModeStore(s => s.toggleMiniMatrix)
  const matrixCollapsed = useViewModeStore(s => s.miniMatrixCollapsed)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Resolve project + currently-open issue summary for the breadcrumb.
  const project = projectAlias ? projects?.find(p => p.alias === projectAlias) : undefined
  const issue = issueId ? recent.find(r => r.id === issueId) : undefined

  // ⌘K opens the command palette (already wired globally by
  // GlobalCommandPalette). We just need a visible button as an entry point;
  // dispatching a keydown is cheap + decoupled.
  const openCommandPalette = () => {
    const evt = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })
    document.dispatchEvent(evt)
  }

  // ⌘N already triggers QuickCreate globally (CockpitQuickCreate listens).
  // The + button here also opens the kanban-style CreateIssueDialog when a
  // project is active. When no project context, we fall back to the global
  // panel-store create dialog (defaults to "default" project per existing
  // CreateIssueDialog behavior).
  const openNew = () => openCreate()

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
              <span
                className="text-xs text-foreground/90 truncate min-w-0 flex-1"
                title={issue.title}
              >
                {issue.title}
              </span>
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
          data-testid="cockpit-topbar-search"
          onClick={openCommandPalette}
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
