import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { ChatArea } from '@/components/issue-detail/ChatArea'
import { DIFF_MIN_WIDTH } from '@/components/issue-detail/diff-constants'
import { LIST_MAX_WIDTH, LIST_MIN_WIDTH } from '@/components/issue-detail/IssueListPanel'
import { ReviewListPanel } from '@/components/issue-detail/ReviewListPanel'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { useReviewIssues } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import { FILE_BROWSER_MIN_WIDTH, useFileBrowserStore } from '@/stores/file-browser-store'

const SIDEBAR_WIDTH = 56
const MIN_CHAT_WIDTH = 300
const DEFAULT_DIFF_WIDTH = 360
const DEFAULT_FILE_BROWSER_WIDTH = 360
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

  const [showDiff, setShowDiff] = useState(false)
  const [diffWidth, setDiffWidth] = useState(DEFAULT_DIFF_WIDTH)
  const [fileBrowserWidth, setFileBrowserWidth] = useState(DEFAULT_FILE_BROWSER_WIDTH)
  const showFileBrowser = useFileBrowserStore(s => s.isOpen)
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
  const isMobile = useIsMobile()

  const handleListWidthChange = useCallback(
    (next: number) => {
      // Clamp against what is left after the sidebar, the diff panel and the
      // chat's minimum — the ceiling moves as those come and go.
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
      const diffSpace = showDiff ? diffWidth : 0
      const dynamicMax = Math.min(
        LIST_MAX_WIDTH,
        viewport - SIDEBAR_WIDTH - diffSpace - MIN_CHAT_WIDTH,
      )
      setListWidth(Math.min(dynamicMax, Math.max(LIST_MIN_WIDTH, next)))
    },
    [showDiff, diffWidth],
  )

  const availableWidth = typeof window !== 'undefined' ? window.innerWidth - SIDEBAR_WIDTH : 1200
  const hideListPanel = (isMobile && !!issueId) || (showDiff && diffWidth > availableWidth * 0.5)

  const handleFileBrowserWidthChange = useCallback(
    (w: number) => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
      const listSpace = hideListPanel ? 0 : listWidth
      const diffSpace = showDiff ? diffWidth : 0
      const maxWidth = viewport - SIDEBAR_WIDTH - listSpace - diffSpace - MIN_CHAT_WIDTH
      setFileBrowserWidth(Math.min(Math.max(FILE_BROWSER_MIN_WIDTH, w), maxWidth))
    },
    [hideListPanel, listWidth, showDiff, diffWidth],
  )

  const handleDiffWidthChange = useCallback(
    (w: number) => {
      const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
      const listSpace = hideListPanel ? 0 : listWidth
      const fbSpace = showFileBrowser ? fileBrowserWidth : 0
      const maxWidth = viewport - SIDEBAR_WIDTH - listSpace - fbSpace - MIN_CHAT_WIDTH
      setDiffWidth(Math.min(Math.max(DIFF_MIN_WIDTH, w), maxWidth))
    },
    [hideListPanel, listWidth, showFileBrowser, fileBrowserWidth],
  )

  useEffect(() => {
    if (!showDiff) return
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1600
    const maxList = Math.min(LIST_MAX_WIDTH, viewport - SIDEBAR_WIDTH - diffWidth - MIN_CHAT_WIDTH)
    setListWidth(prev => Math.max(LIST_MIN_WIDTH, Math.min(prev, maxList)))
  }, [showDiff, diffWidth])

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
              showDiff={showDiff}
              diffWidth={diffWidth}
              onToggleDiff={() => setShowDiff(v => !v)}
              onDiffWidthChange={handleDiffWidthChange}
              onCloseDiff={() => setShowDiff(false)}
              fileBrowserWidth={fileBrowserWidth}
              onFileBrowserWidthChange={handleFileBrowserWidthChange}
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
