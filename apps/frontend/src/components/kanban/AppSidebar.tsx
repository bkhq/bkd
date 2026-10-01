import { Plus, Settings, StickyNote, TerminalSquare, Wifi, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { AppSettingsDialog } from '@/components/AppSettingsDialog'
import { CreateProjectDialog } from '@/components/CreateProjectDialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ViewModeSelect } from '@/components/ViewModeSelect'
import { useEventConnection } from '@/hooks/use-event-connection'
import { useProjects } from '@/hooks/use-kanban'
import { getProjectInitials } from '@/lib/format'
import { GLOBAL_PAGES } from '@/lib/global-pages'
import { useNotesStore } from '@/stores/notes-store'
import { useTerminalStore } from '@/stores/terminal-store'
import { useViewModeStore } from '@/stores/view-mode-store'
import type { Project } from '@/types/kanban'

const INITIALS_CLASS = 'flex items-center justify-center w-9 h-9 shrink-0 rounded-lg text-[11px] font-bold transition-all'

function ProjectButton({
  project,
  isActive,
  onClick,
}: {
  project: Project
  isActive: boolean
  onClick: () => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)

  // The rail hides its scrollbar, so an active project outside the visible
  // range leaves no on-screen trace of which project is selected.
  useEffect(() => {
    if (!isActive) return
    btnRef.current?.scrollIntoView({ block: 'center' })
  }, [isActive])

  return (
    <div className="relative flex items-center justify-center">
      {isActive ?
          (
            <span className="absolute left-[-9px] h-5 w-[3px] rounded-r-full bg-primary" />
          ) :
        null}
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        className={`${INITIALS_CLASS} cursor-pointer focus:outline-none ${
          isActive ?
            'bg-primary text-primary-foreground shadow-sm' :
            'bg-foreground/[0.07] text-foreground/60 hover:bg-foreground/[0.13] hover:text-foreground/80'
        }`}
        aria-label={project.name}
      >
        {getProjectInitials(project.name)}
      </button>
    </div>
  )
}

/**
 * Full project names, opened by hovering the rail. Two-letter initials collide
 * and a per-button tooltip only reveals one name at a time.
 */
function ProjectFlyout({
  projects,
  activeProjectId,
  anchor,
  onSelect,
  onMouseEnter,
  onMouseLeave,
}: {
  projects: Project[]
  activeProjectId: string
  anchor: { left: number, top: number }
  onSelect: (project: Project) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      data-testid="project-flyout"
      role="menu"
      aria-label={t('sidebar.projects')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-[100] w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
      style={{
        left: anchor.left,
        top: anchor.top,
        maxHeight: `calc(100vh - ${anchor.top}px - 0.5rem)`,
      }}
    >
      {projects.map((project) => {
        const isActive = activeProjectId === project.id
        return (
          <button
            key={project.id}
            type="button"
            role="menuitem"
            aria-current={isActive ? 'true' : undefined}
            onClick={() => onSelect(project)}
            className={`flex w-full items-center gap-2 rounded-md p-1 pr-2 text-left text-sm cursor-pointer focus:outline-none ${
              isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
            }`}
          >
            <span
              aria-hidden="true"
              className={`${INITIALS_CLASS} ${
                isActive ?
                  'bg-primary text-primary-foreground' :
                  'bg-foreground/[0.07] text-foreground/60'
              }`}
            >
              {getProjectInitials(project.name)}
            </span>
            <span className="truncate">{project.name}</span>
          </button>
        )
      })}
    </div>
  )
}

export function AppSidebar({ activeProjectId }: { activeProjectId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const projectPath = useViewModeStore(s => s.projectPath)
  const connected = useEventConnection()
  const toggleTerminal = useTerminalStore(s => s.toggle)
  const isTerminalMinimized = useTerminalStore(s => s.isMinimized)
  const toggleNotes = useNotesStore(s => s.toggle)
  const isNotesMinimized = useNotesStore(s => s.isMinimized)

  const railRef = useRef<HTMLDivElement>(null)
  const [flyoutAnchor, setFlyoutAnchor] = useState<{ left: number, top: number } | null>(null)
  // Crossing the gap between rail and flyout fires mouseleave before the
  // flyout's mouseenter; closing on a delay keeps it from flickering shut.
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const openFlyout = useCallback(() => {
    clearTimeout(closeTimer.current)
    const rect = railRef.current?.getBoundingClientRect()
    setFlyoutAnchor({ left: (rect?.right ?? 0) + 4, top: rect?.top ?? 0 })
  }, [])

  const closeFlyout = useCallback(() => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(setFlyoutAnchor, 120, null)
  }, [])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const handleProjectCreated = useCallback(
    (project: Project) => {
      setShowCreate(false)
      void navigate(projectPath(project.id))
    },
    [navigate, projectPath],
  )

  return (
    <div className="flex flex-col items-center h-full w-14 py-3 gap-1 bg-sidebar border-r border-sidebar-border shrink-0">
      {/* Home */}
      <button
        type="button"
        className="flex items-center justify-center w-9 h-9 rounded-lg cursor-pointer focus:outline-none"
        aria-label={t('sidebar.home')}
        title={t('sidebar.home')}
        onClick={() => navigate('/')}
      >
        <AppLogo className="h-9 w-9" />
      </button>

      <Separator className="mx-2 my-1 w-8" />

      {/* Project list */}
      <div
        ref={railRef}
        data-testid="project-rail"
        onMouseEnter={openFlyout}
        onMouseLeave={closeFlyout}
        className="flex flex-col items-center gap-2 overflow-y-auto flex-1 py-1 px-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {projects?.map(project => (
          <ProjectButton
            key={project.id}
            project={project}
            isActive={activeProjectId === project.id}
            onClick={() => navigate(projectPath(project.id))}
          />
        ))}
      </div>
      {flyoutAnchor && projects?.length ?
          (
            <ProjectFlyout
              projects={projects}
              activeProjectId={activeProjectId}
              anchor={flyoutAnchor}
              onSelect={(project) => {
                setFlyoutAnchor(null)
                void navigate(projectPath(project.id))
              }}
              onMouseEnter={openFlyout}
              onMouseLeave={closeFlyout}
            />
          ) :
        null}

      {/* Create project */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setShowCreate(true)}
        className="h-9 w-9 text-muted-foreground"
        aria-label={t('sidebar.createProject')}
        title={t('sidebar.createProject')}
      >
        <Plus className="h-4 w-4" />
      </Button>
      <CreateProjectDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleProjectCreated}
      />

      <Separator className="mx-2 my-0.5 w-8" />

      {/* Bottom section */}
      <div className="mt-auto flex flex-col items-center gap-1">
        <div
          className={`flex items-center justify-center h-9 w-9 ${connected ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}
          title={connected ? t('session.connected') : t('session.disconnected')}
        >
          {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTerminal}
          className="relative h-9 w-9 text-muted-foreground"
          aria-label={t('terminal.title')}
          title={t('terminal.title')}
        >
          <TerminalSquare className="h-4 w-4" />
          {isTerminalMinimized && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleNotes}
          className="relative h-9 w-9 text-muted-foreground"
          aria-label={t('notes.title')}
          title={t('notes.title')}
        >
          <StickyNote className="h-4 w-4" />
          {isNotesMinimized && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
        <ViewModeSelect activeProjectId={activeProjectId} />
        {GLOBAL_PAGES.map(({ id, path, icon: Icon, labelKey }) => (
          <Button
            key={id}
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground"
            aria-label={t(labelKey)}
            title={t(labelKey)}
            onClick={() => navigate(path)}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground"
          aria-label={t('sidebar.settings')}
          title={t('sidebar.settings')}
          onClick={() => setShowSettings(true)}
        >
          <Settings className="h-4 w-4" />
        </Button>
        <AppSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
      </div>
    </div>
  )
}
