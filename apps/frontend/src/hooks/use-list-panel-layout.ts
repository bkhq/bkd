import { useCallback, useEffect, useState } from 'react'
import { LIST_MAX_WIDTH, LIST_MIN_WIDTH } from '@/components/issue-detail/IssueListPanel'
import { useIsMobile } from '@/hooks/use-mobile'
import { shouldHideListPanel } from '@/lib/list-panel'
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store'

const SIDEBAR_WIDTH = 56
const MIN_CHAT_WIDTH = 300
const DEFAULT_LIST_WIDTH = 232

function viewportWidth(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 1600
}

/**
 * Widths of the issue list column and the workspace panel on the issue and
 * review pages, each clamped so the chat between them keeps its minimum.
 */
export function useListPanelLayout(issueId: string) {
  const panelOpen = useWorkspacePanelStore(s => s.isOpen)
  const panelWidth = useWorkspacePanelStore(s => s.width)
  const setPanelWidth = useWorkspacePanelStore(s => s.setWidth)
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
  const isMobile = useIsMobile()

  const handleListWidthChange = useCallback(
    (next: number) => {
      // The ceiling moves as the workspace panel comes and goes.
      const panelSpace = panelOpen ? panelWidth : 0
      const dynamicMax = Math.min(
        LIST_MAX_WIDTH,
        viewportWidth() - SIDEBAR_WIDTH - panelSpace - MIN_CHAT_WIDTH,
      )
      setListWidth(Math.min(dynamicMax, Math.max(LIST_MIN_WIDTH, next)))
    },
    [panelOpen, panelWidth],
  )

  const hideListPanel = shouldHideListPanel({
    isMobile,
    issueId,
    panelOpen,
    panelWidth,
    availableWidth: typeof window !== 'undefined' ? window.innerWidth - SIDEBAR_WIDTH : 1200,
    listMinWidth: LIST_MIN_WIDTH,
    minChatWidth: MIN_CHAT_WIDTH,
  })

  const handlePanelWidthChange = useCallback(
    (w: number) => {
      const listSpace = hideListPanel ? 0 : listWidth
      setPanelWidth(Math.min(w, viewportWidth() - SIDEBAR_WIDTH - listSpace - MIN_CHAT_WIDTH))
    },
    [hideListPanel, listWidth, setPanelWidth],
  )

  // Clamp the list when the workspace panel opens or grows
  useEffect(() => {
    if (!panelOpen) return
    const maxList = Math.min(LIST_MAX_WIDTH, viewportWidth() - SIDEBAR_WIDTH - panelWidth - MIN_CHAT_WIDTH)
    setListWidth(prev => Math.max(LIST_MIN_WIDTH, Math.min(prev, maxList)))
  }, [panelOpen, panelWidth])

  return { isMobile, listWidth, handleListWidthChange, hideListPanel, panelWidth, handlePanelWidthChange }
}
