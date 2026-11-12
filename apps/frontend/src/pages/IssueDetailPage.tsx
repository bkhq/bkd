import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { IssueListPanel } from '@/components/issue-detail/IssueListPanel'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { CreateIssueDialog } from '@/components/kanban/CreateIssueDialog'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useProject } from '@/hooks/use-kanban'
import { useListPanelLayout } from '@/hooks/use-list-panel-layout'

export default function IssueDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projectId = 'default', issueId = '' } = useParams<{
    projectId: string
    issueId: string
  }>()

  const { data: project, isLoading, isError } = useProject(projectId)
  const { isMobile, listWidth, handleListWidthChange, hideListPanel, panelWidth, handlePanelWidthChange }
    = useListPanelLayout(issueId)

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
