import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { IssueListPanel, LIST_MAX_WIDTH, LIST_MIN_WIDTH } from '@/components/issue-detail/IssueListPanel'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { CreateIssueDialog } from '@/components/kanban/CreateIssueDialog'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useProject } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store'

const SIDEBAR_WIDTH = 56
const MIN_CHAT_WIDTH = 300
const DEFAULT_LIST_WIDTH = 232

export default function IssueDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId = 'default', issueId = '' } = useParams<{
    projectId: string
    issueId: string
  }>()

  const { data: project, isLoading, isError } = useProject(projectId)
  const panelOpen = useWorkspacePanelStore(s => s.isOpen)
  const panelWidth = useWorkspacePanelStore(s => s.width)
  const setPanelWidth = useWorkspacePanelStore(s => s.setWidth)
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
  const isMobile = useIsMobile()

  const handleListWidthChange = useCallback(
    (next: number) => {
      // Clamp against what is left after the sidebar, the workspace panel and the
      // chat's minimum — the ceiling moves as those come and go.
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
      const panelSpace = panelOpen ? panelWidth : 0
      const dynamicMax = Math.min(
        LIST_MAX_WIDTH,
        viewport - SIDEBAR_WIDTH - panelSpace - MIN_CHAT_WIDTH,
      )
      setListWidth(Math.min(dynamicMax, Math.max(LIST_MIN_WIDTH, next)))
    },
    [panelOpen, panelWidth],
  )

  // On mobile: show list when no issue selected, show chat when issue selected
  // On desktop: hide list panel when workspace panel needs more than 50% of available space
  const availableWidth = typeof window !== 'undefined' ? window.innerWidth - SIDEBAR_WIDTH : 1200
  const hideListPanel = (isMobile && !!issueId) || (panelOpen && panelWidth > availableWidth * 0.5)

  const handlePanelWidthChange = useCallback(
    (w: number) => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
      const listSpace = hideListPanel ? 0 : listWidth
      setPanelWidth(Math.min(w, viewport - SIDEBAR_WIDTH - listSpace - MIN_CHAT_WIDTH))
    },
    [hideListPanel, listWidth, setPanelWidth],
  )

  // Clamp listWidth when workspace panel opens or grows to preserve MIN_CHAT_WIDTH
  useEffect(() => {
    if (!panelOpen) return
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
    const maxList = Math.min(LIST_MAX_WIDTH, viewport - SIDEBAR_WIDTH - panelWidth - MIN_CHAT_WIDTH)
    setListWidth(prev => Math.max(LIST_MIN_WIDTH, Math.min(prev, maxList)))
  }, [panelOpen, panelWidth])

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
    <div className="flex h-full text-foreground overflow-hidden animate-page-enter">
      {/* Sidebar — hidden on mobile */}
      {!isMobile ? <AppSidebar activeProjectId={projectId} /> : null}

      {/* Issue list panel — hidden on mobile (replaced by full-page views) */}
      {!hideListPanel ?
          (
            <IssueListPanel
              projectId={projectId}
              activeIssueId={issueId}
              projectName={project.name}
              width={isMobile ? undefined : listWidth}
              onWidthChange={isMobile ? undefined : handleListWidthChange}
              mobileNav={isMobile ? <MobileSidebar activeProjectId={projectId} /> : undefined}
            />
          ) :
        null}

      {/* Chat area when issue is selected */}
      {issueId ?
          (
            <ChatArea
              projectId={projectId}
              issueId={issueId}
              panelWidth={panelWidth}
              onPanelWidthChange={handlePanelWidthChange}
              showBackToList
            />
          ) :
          !hideListPanel ?
              (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-muted-foreground">{t('issue.selectToStart')}</p>
                </div>
              ) :
            null}
      <CreateIssueDialog />
    </div>
  )
}
