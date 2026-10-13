import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { LIST_MAX_WIDTH, LIST_MIN_WIDTH } from '@/components/issue-detail/IssueListPanel'
import { ReviewListPanel } from '@/components/issue-detail/ReviewListPanel'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useReviewIssues } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { shouldHideListPanel } from '@/lib/list-panel'
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store'

const SIDEBAR_WIDTH = 56
const MIN_CHAT_WIDTH = 300
const DEFAULT_LIST_WIDTH = 232

export default function ReviewPage() {
  const { t } = useTranslation()
  const { projectId: projectIdParam = '', issueId = '' } = useParams<{
    projectId: string
    issueId: string
  }>()

  const { data: reviewIssues } = useReviewIssues()

  // Prefer the resolved issue's projectId; fall back to the URL param
  const activeIssue = reviewIssues?.find(i => i.id === issueId)
  const projectId = activeIssue?.projectId ?? projectIdParam

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

  const availableWidth = typeof window !== 'undefined' ? window.innerWidth - SIDEBAR_WIDTH : 1200
  const hideListPanel = shouldHideListPanel({ isMobile, issueId, panelOpen, panelWidth, availableWidth })

  const handlePanelWidthChange = useCallback(
    (w: number) => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
      const listSpace = hideListPanel ? 0 : listWidth
      setPanelWidth(Math.min(w, viewport - SIDEBAR_WIDTH - listSpace - MIN_CHAT_WIDTH))
    },
    [hideListPanel, listWidth, setPanelWidth],
  )

  useEffect(() => {
    if (!panelOpen) return
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
    const maxList = Math.min(LIST_MAX_WIDTH, viewport - SIDEBAR_WIDTH - panelWidth - MIN_CHAT_WIDTH)
    setListWidth(prev => Math.max(LIST_MIN_WIDTH, Math.min(prev, maxList)))
  }, [panelOpen, panelWidth])

  return (
    <div className="flex h-full text-foreground overflow-hidden animate-page-enter">
      {!isMobile ? <AppSidebar activeProjectId="" /> : null}

      {!hideListPanel ?
          (
            <ReviewListPanel
              activeIssueId={issueId}
              width={isMobile ? undefined : listWidth}
              onWidthChange={isMobile ? undefined : handleListWidthChange}
              mobileNav={isMobile ? <MobileSidebar activeProjectId="" /> : undefined}
            />
          ) :
        null}

      {issueId && projectId ?
          (
            <ChatArea
              projectId={projectId}
              issueId={issueId}
              panelWidth={panelWidth}
              onPanelWidthChange={handlePanelWidthChange}
              showBackToList
              backPath="/review"
            />
          ) :
          !hideListPanel ?
              (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-muted-foreground">{t('review.selectToStart')}</p>
                </div>
              ) :
            null}
    </div>
  )
}
