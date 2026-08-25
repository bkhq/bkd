import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { CreateIssueDialog } from '@/components/kanban/CreateIssueDialog'
import { IssuePanel } from '@/components/kanban/IssuePanel'
import { KanbanBoard } from '@/components/kanban/KanbanBoard'
import { KanbanHeader } from '@/components/kanban/KanbanHeader'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { useIssues, useProject } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { DEFAULT_STATUS_ID } from '@/lib/statuses'
import {
  PANEL_MAX_WIDTH_RATIO,
  PANEL_MIN_WIDTH,
  useIsPanelOpen,
  usePanelStore,
} from '@/stores/panel-store'

export default function KanbanPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId = 'default' } = useParams<{ projectId: string }>()
  const { data: project, isLoading, isError } = useProject(projectId)
  const { data: issues } = useIssues(projectId)

  const panel = usePanelStore(s => s.panel)
  const width = usePanelStore(s => s.width)
  const close = usePanelStore(s => s.close)
  const openView = usePanelStore(s => s.openView)
  const setWidth = usePanelStore(s => s.setWidth)
  const panelMaxWidth = Math.round(
    (typeof window === 'undefined' ? 800 : window.innerWidth) * PANEL_MAX_WIDTH_RATIO,
  )
  const isPanelOpen = useIsPanelOpen()
  const isMobile = useIsMobile()
  const [searchQuery, setSearchQuery] = useState('')

  const handleCardClick = useCallback(
    (issue: { id: string }) => {
      if (isMobile) {
        void navigate(`/projects/${projectId}/issues/${issue.id}`)
      } else {
        openView(issue.id)
      }
    },
    [isMobile, navigate, projectId, openView],
  )

  useEffect(() => {
    if (!isLoading && (isError || !project)) {
      void navigate('/', { replace: true })
    }
  }, [isLoading, isError, project, navigate])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">{t('kanban.loadingProject')}</p>
      </div>
    )
  }

  if (isError || !project) {
    return null
  }

  return (
    <div className="flex h-full text-foreground animate-page-enter">
      {/* Left Sidebar — hidden on mobile */}
      {!isMobile ? <AppSidebar activeProjectId={projectId} /> : null}

      {/* Main Content — inert when panel is open on desktop */}
      <div
        className="flex flex-1 min-w-0 flex-col"
        {...(!isMobile && isPanelOpen ? { inert: true } : {})}
      >
        <KanbanHeader
          project={project}
          issueCount={issues?.length ?? 0}
          defaultStatusId={DEFAULT_STATUS_ID}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          mobileNav={isMobile ? <MobileSidebar activeProjectId={projectId} /> : undefined}
        />

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <KanbanBoard
              projectId={projectId}
              searchQuery={searchQuery}
              onCardClick={handleCardClick}
            />
          </div>
        </div>
      </div>

      {/* Overlay — covers entire page, click to close panel (desktop only) */}
      {!isMobile && isPanelOpen
        ? (
            <div className="fixed inset-0 z-20 bg-black/50" onClick={close} />
          )
        : null}

      {/* Create Issue Dialog */}
      <CreateIssueDialog />

      {/* Issue Side Panel — desktop only; mobile navigates to detail page */}
      {!isMobile && isPanelOpen && panel.kind === 'view'
        ? (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('kanban.issueDetails')}
              className="fixed inset-y-0 right-0 z-30 border-l border-border bg-card"
              style={{ width }}
            >
              <ResizeHandle
                width={width}
                onWidthChange={setWidth}
                min={PANEL_MIN_WIDTH}
                max={panelMaxWidth}
                label={t('kanban.resizePanel')}
              />
              <IssuePanel projectId={projectId} issueId={panel.issueId} onClose={close} />
            </div>
          )
        : null}
    </div>
  )
}
