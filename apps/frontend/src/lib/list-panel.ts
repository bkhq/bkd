/**
 * Whether the issue list column gives way on the issue / review pages: on
 * mobile while an issue is open, or when the open workspace panel needs more
 * than half the width or would leave the chat below its minimum beside the
 * list's minimum. Without a selected issue there is no panel on screen, so the
 * list (or its empty state) always shows.
 */
export function shouldHideListPanel({
  isMobile,
  issueId,
  panelOpen,
  panelWidth,
  availableWidth,
  listMinWidth,
  minChatWidth,
}: {
  isMobile: boolean
  issueId: string
  panelOpen: boolean
  panelWidth: number
  /** Viewport minus the app rail. */
  availableWidth: number
  listMinWidth: number
  minChatWidth: number
}): boolean {
  if (!issueId) return false
  if (isMobile) return true
  if (!panelOpen) return false
  return panelWidth > availableWidth * 0.5 || availableWidth - panelWidth - listMinWidth < minChatWidth
}
