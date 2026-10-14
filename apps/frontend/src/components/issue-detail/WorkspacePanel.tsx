import { FileDiff, FolderOpen, Maximize2, Minimize2, PanelRight, PanelRightClose, Plus, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FileBrowserContent } from '@/components/files/FileBrowserContent'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { SidePanelButton } from '@/components/ui/side-panel'
import { useChangesSummary } from '@/hooks/use-changes-summary'
import { useIssueChanges, useProject, useProjectFiles } from '@/hooks/use-kanban'
import { cn } from 'cn'
import { useDiffViewStore } from '@/stores/diff-view-store'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import type { WorkspaceTab } from '@/stores/workspace-panel-store'
import { useWorkspacePanelStore, WORKSPACE_PANEL_MIN_WIDTH } from '@/stores/workspace-panel-store'
import { DiffChanges } from './DiffPanel'

const TAB_ICONS: Record<WorkspaceTab, LucideIcon> = {
  files: FolderOpen,
  review: FileDiff,
}

/** Panel width that leaves room for a file tree beside the content. */
const TREE_PANEL_WIDTH = 640

const LAUNCHER_TABS: WorkspaceTab[] = ['files', 'review']

/** Entry count of the directory the file browser is showing; null on a file view. */
function useFileBrowserEntryCount(): number | null {
  const projectId = useFileBrowserStore(s => s.projectId)
  const rootPath = useFileBrowserStore(s => s.rootPath)
  const currentPath = useFileBrowserStore(s => s.currentPath)
  const { data: project } = useProject(projectId ?? '')
  // Same query as FileBrowserContent, so this reads its cache.
  const { data: listing } = useProjectFiles(rootPath ?? project?.directory ?? null, currentPath)
  return listing?.type === 'directory' ? listing.entries.length : null
}

export function WorkspacePanel({
  projectId,
  issueId,
  width,
  onWidthChange,
  fullScreen,
}: {
  projectId: string
  issueId: string
  width: number
  onWidthChange: (w: number) => void
  fullScreen?: boolean
}) {
  const { t } = useTranslation()
  const tabs = useWorkspacePanelStore(s => s.tabs)
  const activeTab = useWorkspacePanelStore(s => s.activeTab)
  const setActiveTab = useWorkspacePanelStore(s => s.setActiveTab)
  const closeTab = useWorkspacePanelStore(s => s.closeTab)
  const openTab = useWorkspacePanelStore(s => s.openTab)
  const hide = useWorkspacePanelStore(s => s.hide)
  const isMaximized = useWorkspacePanelStore(s => s.isMaximized)
  const toggleMaximized = useWorkspacePanelStore(s => s.toggleMaximized)

  // A file tree takes ~224px, so make room when one is showing in this panel
  const reviewTree = useDiffViewStore(s => s.showTree)
  const filesTree = useFileBrowserStore(s => s.showTree)
  const treeShown = (activeTab === 'review' && reviewTree) || (activeTab === 'files' && filesTree)
  useEffect(() => {
    if (treeShown) useWorkspacePanelStore.getState().ensureWidth(TREE_PANEL_WIDTH)
  }, [treeShown])

  const changesSummary = useChangesSummary(projectId, issueId)
  // The issue's own workspace (its worktree, or the project directory). Until
  // /changes answers it is unknown (undefined): the Files tab must wait rather
  // than fall back to the project directory, which for a worktree issue is the
  // main checkout. null means the project has no directory at all.
  const changes = useIssueChanges(projectId, issueId)
  const issueRoot = changes.data ? (changes.data.root ?? null) : undefined
  const fileCount = useFileBrowserEntryCount()
  const counts: Record<WorkspaceTab, number | null> = {
    files: fileCount,
    review: changesSummary?.fileCount ?? 0,
  }

  // Bind the shared file browser to this issue's workspace once it is known,
  // unless the global drawer currently owns it; it re-binds once the drawer
  // closes. The tab only renders the browser while it is bound here.
  const hasFilesTab = tabs.includes('files')
  const fbIssueId = useFileBrowserStore(s => s.issueId)
  const fbRootPath = useFileBrowserStore(s => s.rootPath)
  const fbOpen = useFileBrowserStore(s => s.isOpen)
  const fbDrawer = useFileBrowserStore(s => s.isDrawer)
  const drawerOwnsBrowser = fbOpen && fbDrawer
  const filesBound = issueRoot !== undefined && fbOpen && !fbDrawer && fbIssueId === issueId && fbRootPath === issueRoot
  const bindFiles = () => {
    if (issueRoot !== undefined) useFileBrowserStore.getState().openForIssue(projectId, issueId, issueRoot ?? undefined)
  }
  useEffect(() => {
    if (!hasFilesTab || issueRoot === undefined || drawerOwnsBrowser || filesBound) return
    useFileBrowserStore.getState().openForIssue(projectId, issueId, issueRoot ?? undefined)
  }, [hasFilesTab, issueRoot, drawerOwnsBrowser, filesBound, projectId, issueId])

  const maxWidth = typeof window === 'undefined' ? 1600 : window.innerWidth

  return (
    <div
      className={
        fullScreen
          ? 'flex flex-col flex-1 min-w-0 min-h-0 bg-background'
          : 'relative h-full w-full border-l border-border bg-background'
      }
    >
      {/* The caller's wrapper owns the width; maximized has nothing to resize */}
      {!fullScreen && !isMaximized && (
        <ResizeHandle
          width={width}
          onWidthChange={onWidthChange}
          min={WORKSPACE_PANEL_MIN_WIDTH}
          max={maxWidth}
          label={t('workspace.resizePanel')}
        />
      )}

      <div className="flex flex-col h-full min-h-0">
        {/* Tab bar */}
        <div role="tablist" className="flex items-center gap-1 px-2 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] bg-background/80 backdrop-blur-sm">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab]
            const label = t(`workspace.${tab}`)
            const closeLabel = t('workspace.closeTab', { name: label })
            const count = counts[tab]
            const active = tab === activeTab
            return (
              <div
                key={tab}
                className={cn(
                  'group/tab flex items-center gap-0.5 rounded-lg h-7 pl-2 pr-1 text-xs transition-colors',
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab)}
                  className="flex items-center gap-1.5 font-medium"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {count !== null && (
                    <span className="text-[10px] font-medium text-muted-foreground/70 bg-muted/60 rounded-full px-1.5 tabular-nums">
                      {count}
                    </span>
                  )}
                </button>
                {/* Space stays reserved so hovering does not shift the tabs */}
                <button
                  type="button"
                  onClick={() => closeTab(tab)}
                  className={cn(
                    'flex items-center justify-center h-5 w-5 rounded transition-opacity hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100',
                    active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100 pointer-coarse:opacity-100',
                  )}
                  aria-label={closeLabel}
                  title={closeLabel}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
          <div className="ml-auto flex h-7 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={t('workspace.addTab')}
                title={t('workspace.addTab')}
              >
                <Plus className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-auto min-w-0">
                {LAUNCHER_TABS.map((tab) => {
                  const Icon = TAB_ICONS[tab]
                  return (
                    <DropdownMenuItem key={tab} onClick={() => openTab(tab)} className="whitespace-nowrap pr-2.5 text-xs">
                      <Icon className="h-3.5 w-3.5" />
                      {t(`workspace.open.${tab}`)}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {fullScreen
              ? <SidePanelButton icon={PanelRightClose} label={t('workspace.hidePanel')} onClick={hide} />
              : (
                  <>
                    <SidePanelButton
                      icon={isMaximized ? Minimize2 : Maximize2}
                      label={isMaximized ? t('workspace.restorePanel') : t('workspace.maximizePanel')}
                      onClick={toggleMaximized}
                    />
                    <SidePanelButton icon={PanelRight} label={t('workspace.hidePanel')} onClick={hide} />
                  </>
                )}
          </div>
        </div>

        {/* Tab contents stay mounted so switching keeps their state */}
        {hasFilesTab && (
          <div className={cn('flex flex-col flex-1 min-h-0', activeTab !== 'files' && 'hidden')}>
            {filesBound
              ? <FileBrowserContent />
              : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                    {changes.isError
                      ? (
                          <>
                            <p>{t('workspace.rootLoadFailed')}</p>
                            <button type="button" onClick={() => void changes.refetch()} className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent">
                              {t('workspace.retry')}
                            </button>
                          </>
                        )
                      : drawerOwnsBrowser && issueRoot !== undefined
                        ? (
                            <>
                              <p>{t('workspace.browserInDrawer')}</p>
                              <button type="button" onClick={bindFiles} className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent">
                                {t('workspace.openHere')}
                              </button>
                            </>
                          )
                        : <p>{t('common.loading')}</p>}
                  </div>
                )}
          </div>
        )}
        {tabs.includes('review') && (
          <div className={cn('flex flex-col flex-1 min-h-0', activeTab !== 'review' && 'hidden')}>
            <DiffChanges projectId={projectId} issueId={issueId} toolbar />
          </div>
        )}

        {/* No tabs open: launcher */}
        {tabs.length === 0 && (
          <div className="flex flex-1 min-h-0 items-center justify-center p-6">
            <div className="flex w-full max-w-[280px] flex-col gap-2">
              {LAUNCHER_TABS.map((tab) => {
                const Icon = TAB_ICONS[tab]
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => openTab(tab)}
                    className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 p-2.5 text-left transition-colors hover:border-border hover:bg-accent/60"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{t(`workspace.open.${tab}`)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{t(`workspace.openHint.${tab}`)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
