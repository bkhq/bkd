import { cn } from 'cn'
import { ArrowLeft, PanelRight } from 'lucide-react'
import type { AnimationEvent } from 'react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useIssue, useUpdateIssue } from '@/hooks/use-kanban'
import { IssueContextMenu, IssueContextMenuButton } from '@/components/issue-detail/IssueContextMenu'
import { useIsMobile } from '@/hooks/use-mobile'
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store'
import { ChatBody } from './ChatBody'
import { isImeComposing } from '@/lib/keyboard'

const LazyWorkspacePanel = lazy(() => import('./WorkspacePanel').then(m => ({ default: m.WorkspacePanel })))

type PanelPhase = 'closed' | 'entering' | 'open' | 'leaving'

const PANEL_ANIMATION: Record<PanelPhase, { inline: string, overlay: string }> = {
  closed: { inline: '', overlay: '' },
  entering: { inline: 'animate-panel-expand', overlay: 'animate-panel-slide-in' },
  open: { inline: '', overlay: '' },
  leaving: { inline: 'animate-panel-collapse', overlay: 'animate-panel-slide-out' },
}

export function ChatArea({
  projectId,
  issueId,
  panelWidth,
  onPanelWidthChange,
  showBackToList,
  backPath,
}: {
  projectId: string
  issueId: string
  panelWidth: number
  onPanelWidthChange: (w: number) => void
  showBackToList?: boolean
  backPath?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: issue, isLoading, isError } = useIssue(projectId, issueId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const isMobile = useIsMobile()
  const panelOpen = useWorkspacePanelStore(s => s.isOpen)
  const panelMaximized = useWorkspacePanelStore(s => s.isOpen && s.isMaximized && !isMobile)
  const reviewOpen = useWorkspacePanelStore(s => s.isOpen && s.activeTab === 'review')
  const togglePanel = useWorkspacePanelStore(s => s.togglePanel)
  const toggleTab = useWorkspacePanelStore(s => s.toggleTab)
  const toggleMaximized = useWorkspacePanelStore(s => s.toggleMaximized)

  // Width transition window for maximize/restore
  const [maxAnimating, setMaxAnimating] = useState(false)
  const [prevMaximized, setPrevMaximized] = useState(panelMaximized)
  if (prevMaximized !== panelMaximized) {
    setPrevMaximized(panelMaximized)
    setMaxAnimating(true)
  }
  useEffect(() => {
    if (!maxAnimating) return
    const id = setTimeout(setMaxAnimating, 350, false)
    return () => clearTimeout(id)
  }, [maxAnimating])

  // The panel stays mounted through its exit animation: 'leaving' renders the
  // collapse and animationend unmounts it.
  const [panelPhase, setPanelPhase] = useState<PanelPhase>(panelOpen ? 'open' : 'closed')
  if (panelOpen && (panelPhase === 'closed' || panelPhase === 'leaving')) setPanelPhase('entering')
  if (!panelOpen && (panelPhase === 'open' || panelPhase === 'entering')) setPanelPhase('leaving')
  const handlePanelAnimationEnd = useCallback((e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    setPanelPhase(p => (p === 'entering' ? 'open' : p === 'leaving' ? 'closed' : p))
  }, [])

  const updateIssue = useUpdateIssue(projectId)

  const saveTitle = useCallback(() => {
    const trimmed = titleDraft.trim()
    if (trimmed && trimmed !== issue?.title) {
      updateIssue.mutate({ id: issueId, title: trimmed })
    }
    setEditingTitle(false)
  }, [titleDraft, issue?.title, updateIssue, issueId])

  const startEditingTitle = useCallback(() => {
    if (issue) {
      setTitleDraft(issue.title)
      setEditingTitle(true)
    }
  }, [issue])

  const defaultBack = showBackToList ? `/projects/${projectId}/issues` : `/projects/${projectId}`
  const resolvedBackPath = backPath ?? defaultBack

  const handleAfterDelete = useCallback(() => {
    void navigate(resolvedBackPath)
  }, [navigate, resolvedBackPath])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (isError || !issue) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive">{t('issue.notFound')}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            onClick={() => navigate(backPath ?? `/projects/${projectId}`)}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {backPath ? t('issue.backToList') : t('issue.backToBoard')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative isolate flex flex-1 min-w-0 bg-background overflow-hidden">
      {/* Chat column */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-2.5 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] md:gap-2.5 md:px-3 bg-background/80 backdrop-blur-sm">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0 transition-colors"
            onClick={() => navigate(resolvedBackPath)}
            title={
              backPath ?
                  t('issue.backToList') :
                showBackToList ?
                    t('issue.backToList') :
                    t('issue.backToBoard')
            }
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                #
                {issue.issueNumber}
              </span>
              {editingTitle ?
                  (
                    <input
                      className="text-base md:text-sm font-semibold bg-transparent border-b-2 border-primary outline-none min-w-0 flex-1 tracking-tight"
                      value={titleDraft}
                      onChange={e => setTitleDraft(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isImeComposing(e)) {
                          e.preventDefault()
                          saveTitle()
                        } else if (e.key === 'Escape') {
                          setEditingTitle(false)
                        }
                      }}
                      autoFocus
                    />
                  ) :
                  (
                    <span
                      className="text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors duration-200 tracking-tight decoration-primary/30 hover:underline underline-offset-2"
                      onClick={startEditingTitle}
                      title={t('issue.editTitle')}
                    >
                      {issue.title}
                    </span>
                  )}
            </div>
          </div>
          <IssueContextMenu issue={issue} projectId={projectId} showPin showCopyLink onDeleted={handleAfterDelete}>
            <IssueContextMenuButton className="h-7 w-7 shrink-0" />
          </IssueContextMenu>
          {/* While the panel is open, its own header carries the hide button */}
          {!panelOpen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              onClick={togglePanel}
              title={t('workspace.showPanel')}
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Shared chat body: messages + metadata bar + input */}
        <ChatBody
          projectId={projectId}
          issueId={issueId}
          issue={issue}
          showDiff={reviewOpen}
          onToggleDiff={() => toggleTab('review')}
          onToggleFiles={() => toggleTab('files')}
          scrollRef={scrollRef}
          onAfterDelete={handleAfterDelete}
        />
      </div>

      {/* Workspace panel — full-screen overlay on mobile, inline on desktop */}
      {panelPhase !== 'closed'
        ? (
            isMobile
              ? (
                  <div
                    className={`fixed inset-0 z-40 bg-background flex flex-col ${PANEL_ANIMATION[panelPhase].overlay}`}
                    onAnimationEnd={handlePanelAnimationEnd}
                  >
                    <Suspense
                      fallback={(
                        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                          {t('common.loading')}
                        </div>
                      )}
                    >
                      <LazyWorkspacePanel
                        projectId={projectId}
                        issueId={issueId}
                        width={0}
                        onWidthChange={onPanelWidthChange}
                        fullScreen
                      />
                    </Suspense>
                  </div>
                )
              : (
                  <>
                    {/* Holds the panel's place in the row. The panel floats
                        above it, so maximizing never reflows the chat. */}
                    <div
                      aria-hidden
                      className={`shrink-0 ${PANEL_ANIMATION[panelPhase].inline}`}
                      style={{ width: panelWidth }}
                    />
                    {/* Mask over the chat while maximized; click to restore */}
                    <div
                      aria-hidden
                      className={cn(
                        'absolute inset-0 z-40 bg-black/20 transition-opacity duration-300 dark:bg-black/50',
                        panelMaximized ? 'opacity-100' : 'pointer-events-none opacity-0',
                      )}
                      onClick={toggleMaximized}
                    />
                    <div
                      className={cn(
                        'absolute inset-y-0 right-0 z-50 flex',
                        PANEL_ANIMATION[panelPhase].overlay,
                        // Only while maximize toggles, so drag-resizing stays immediate
                        maxAnimating && 'transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                        panelMaximized && 'shadow-2xl',
                      )}
                      style={{ width: panelMaximized ? 'calc(100% - 3rem)' : panelWidth }}
                      onAnimationEnd={handlePanelAnimationEnd}
                    >
                      <Suspense
                        fallback={(
                          <div className="flex h-full w-full items-center justify-center border-l border-border bg-background text-sm text-muted-foreground">
                            {t('common.loading')}
                          </div>
                        )}
                      >
                        <LazyWorkspacePanel
                          projectId={projectId}
                          issueId={issueId}
                          width={panelWidth}
                          onWidthChange={onPanelWidthChange}
                        />
                      </Suspense>
                    </div>
                  </>
                )
          )
        : null}
    </div>
  )
}
