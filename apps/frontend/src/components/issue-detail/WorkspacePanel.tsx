import { Maximize2, Minimize2, PanelRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WorkspaceFiles } from '@/components/files/WorkspaceFiles'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { SidePanelButton } from '@/components/ui/side-panel'
import { useIssueChanges } from '@/hooks/use-kanban'
import { useWorkspacePanelStore, WORKSPACE_PANEL_MIN_WIDTH } from '@/stores/workspace-panel-store'

/** The issue's workspace in the file manager, which browses and reviews its changes alike. */
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
  const hide = useWorkspacePanelStore(s => s.hide)
  const isMaximized = useWorkspacePanelStore(s => s.isMaximized)
  const toggleMaximized = useWorkspacePanelStore(s => s.toggleMaximized)

  // Until /changes answers, whether the issue works in a worktree is unknown:
  // wait rather than open the project directory, which for a worktree issue is
  // the main checkout.
  const changes = useIssueChanges(projectId, issueId)
  // A worktree issue with no worktree (not created yet, or cleaned up) gets the
  // project root back: never open that as its workspace
  const worktreeMissing = !!changes.data?.worktreeMissing

  const maxWidth = typeof window === 'undefined' ? 1600 : window.innerWidth

  // The file manager's top bar holds these; the chat area's floating toggle shows only while the panel is closed
  const actions = (
    <>
      {!fullScreen && (
        <SidePanelButton
          icon={isMaximized ? Minimize2 : Maximize2}
          label={isMaximized ? t('workspace.restorePanel') : t('workspace.maximizePanel')}
          onClick={toggleMaximized}
        />
      )}
      <SidePanelButton icon={PanelRight} label={t('workspace.hidePanel')} onClick={hide} />
    </>
  )

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
        <div className="flex flex-col flex-1 min-h-0">
          {changes.data && !worktreeMissing
            ? <WorkspaceFiles projectId={projectId} issueId={issueId} headerActions={actions} />
            : (
                <>
                  <div className="flex h-9 shrink-0 items-center justify-end gap-0.5 border-b px-2">{actions}</div>
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                    {worktreeMissing
                      ? <p>{t('workspace.worktreeMissing')}</p>
                      : changes.isError
                        ? (
                            <>
                              <p>{t('workspace.rootLoadFailed')}</p>
                              <button type="button" onClick={() => void changes.refetch()} className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent">
                                {t('workspace.retry')}
                              </button>
                            </>
                          )
                        : <p>{t('common.loading')}</p>}
                  </div>
                </>
              )}
        </div>
      </div>
    </div>
  )
}
