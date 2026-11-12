import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { ReviewListPanel } from '@/components/issue-detail/ReviewListPanel'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useReviewIssues } from '@/hooks/use-kanban'
import { useListPanelLayout } from '@/hooks/use-list-panel-layout'

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

  const { isMobile, listWidth, handleListWidthChange, hideListPanel, panelWidth, handlePanelWidthChange }
    = useListPanelLayout(issueId)

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
