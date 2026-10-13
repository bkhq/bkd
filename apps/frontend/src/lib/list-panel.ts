/**
 * Whether the issue list column gives way on the issue / review pages: on
 * mobile while an issue is open, or when the workspace panel needs more than
 * half the width. Without a selected issue there is no panel on screen, so the
 * list (or its empty state) always shows.
 */
export function shouldHideListPanel({
  isMobile,
  issueId,
  panelOpen,
  panelWidth,
  availableWidth,
}: {
  isMobile: boolean
  issueId: string
  panelOpen: boolean
  panelWidth: number
  availableWidth: number
}): boolean {
  if (!issueId) return false
  return isMobile || (panelOpen && panelWidth > availableWidth * 0.5)
}
