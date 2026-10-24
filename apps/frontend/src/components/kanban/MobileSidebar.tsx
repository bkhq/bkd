import { ChevronRight, Menu, Plus, Settings, StickyNote, TerminalSquare, Wifi, WifiOff, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { AppSettingsDialog } from '@/components/AppSettingsDialog'
import { CreateProjectDialog } from '@/components/CreateProjectDialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useWaitingMessageCount } from '@/hooks/use-messages'
import { useEventConnection } from '@/hooks/use-event-connection'
import { useProjects } from '@/hooks/use-kanban'
import { getProjectInitials } from '@/lib/format'
import { GLOBAL_PAGES, isGlobalPageActive } from '@/lib/global-pages'
import { useNotesStore } from '@/stores/notes-store'
import { useServerStore } from '@/stores/server-store'
import { useTerminalStore } from '@/stores/terminal-store'
import type { Project } from '@/types/kanban'

export function MobileSidebarTrigger({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground md:hidden"
      aria-label={t('sidebar.menu')}
      onClick={onOpen}
    >
      <Menu className="h-5 w-5" />
    </Button>
  )
}

export function MobileSidebar({ activeProjectId }: { activeProjectId: string }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data: projects } = useProjects()
  const waitingMessages = useWaitingMessageCount()
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const serverName = useServerStore(s => s.name)
  const connected = useEventConnection()

  // Mobile always uses list mode
  const mobileProjectPath = useCallback((projectId: string) => `/projects/${projectId}/issues`, [])

  const handleProjectCreated = useCallback(
    (project: Project) => {
      setShowCreate(false)
      setOpen(false)
      void navigate(mobileProjectPath(project.id))
    },
    [navigate, mobileProjectPath],
  )

  return (
    <>
      <MobileSidebarTrigger onOpen={() => setOpen(true)} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0" showCloseButton={false} aria-describedby={undefined}>
          <SheetTitle className="sr-only">{t('sidebar.menu')}</SheetTitle>

          <div className="flex flex-col h-full">
            {/* Header -- links to homepage; same name source as the document title.
                The close button sits in this row (not the sheet's absolute one) so it lines up. */}
            <div className="flex items-center gap-2 border-b pr-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  void navigate('/')
                }}
                className="flex min-w-0 flex-1 items-center gap-3 pl-4 py-3 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <AppLogo className="h-8 w-8" />
                <span className="text-sm font-semibold truncate">{serverName ?? 'BKD'}</span>
              </button>
              <span
                className={`shrink-0 ${connected ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}
                title={connected ? t('session.connected') : t('session.disconnected')}
              >
                {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              </span>
              <SheetClose
                render={<Button variant="ghost" size="icon-sm" />}
                aria-label={t('sidebar.closeMenu')}
                title={t('sidebar.closeMenu')}
              >
                <X className="h-4 w-4" />
              </SheetClose>
            </div>

            {/* Project list */}
            <div className="px-4 pt-3 pb-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {t('project.projects')}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-2" style={{ scrollbarWidth: 'none' }}>
              {projects?.map((project) => {
                const isActive = activeProjectId === project.id
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      void navigate(mobileProjectPath(project.id))
                    }}
                    className={`flex items-center gap-3 w-full px-2 min-h-[44px] rounded-md text-left transition-colors ${
                      isActive ?
                        'bg-primary/10 text-foreground' :
                        'text-foreground/80 hover:bg-accent/50 active:bg-accent'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${
                        isActive ?
                          'bg-primary text-primary-foreground' :
                          'bg-foreground/[0.07] text-foreground/60'
                      }`}
                    >
                      {getProjectInitials(project.name)}
                    </div>
                    <span className="text-sm truncate">{project.name}</span>
                    {isActive ?
                        (
                          <ChevronRight className="h-3.5 w-3.5 ml-auto text-primary shrink-0" />
                        ) :
                      null}
                  </button>
                )
              })}
            </div>

            {/* Bottom actions */}
            <div className="border-t mt-auto">
              {/* New project */}
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                {t('sidebar.createProject')}
              </button>

              <Separator />

              {/* Functional buttons grouped together */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  useTerminalStore.getState().openFullscreen()
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <TerminalSquare className="h-4 w-4 text-muted-foreground" />
                {t('terminal.title')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  useNotesStore.getState().openFullscreen()
                }}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <StickyNote className="h-4 w-4 text-muted-foreground" />
                {t('notes.title')}
              </button>
              {GLOBAL_PAGES.map((page) => {
                const { id, path, icon: Icon, labelKey } = page
                const isActive = isGlobalPageActive(page, pathname)
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => {
                      setOpen(false)
                      void navigate(path)
                    }}
                    className={`flex items-center gap-3 w-full px-4 min-h-[44px] text-sm transition-colors ${isActive ? 'bg-accent text-foreground font-medium' : 'text-foreground/80 hover:bg-accent/50 active:bg-accent'}`}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {t(labelKey)}
                    {id === 'messages' && waitingMessages > 0 && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
                        {waitingMessages}
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-3 w-full px-4 min-h-[44px] text-sm text-foreground/80 hover:bg-accent/50 active:bg-accent transition-colors"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                {t('sidebar.settings')}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <CreateProjectDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={handleProjectCreated}
      />
      <AppSettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </>
  )
}
