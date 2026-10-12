interface FlyoutPlacementInput {
  /** Viewport y of the hovered icon's centre. */
  anchorCenter: number
  /** Distance from the flyout's top edge to the centre of the matching row. */
  rowCenter: number
  /** Natural height of the flyout, border included. */
  flyoutHeight: number
  viewportHeight: number
  /** Minimum gap kept to the viewport's top and bottom edges. */
  margin?: number
}

interface FlyoutPlacement {
  top: number
  /** Height cap that keeps the flyout inside the viewport. */
  maxHeight: number
  /** Scroll offset that brings the matching row level with the icon. */
  scrollTop: number
}

/**
 * Place a flyout so its row for the hovered icon sits level with that icon.
 *
 * The flyout is nudged to stay inside the viewport. When the list is taller
 * than the viewport it is pinned to the margins and scrolled instead, so the
 * matching row still lines up with the icon where the window allows.
 */
export function placeFlyout({
  anchorCenter,
  rowCenter,
  flyoutHeight,
  viewportHeight,
  margin = 8,
}: FlyoutPlacementInput): FlyoutPlacement {
  const maxHeight = viewportHeight - 2 * margin
  const height = Math.min(flyoutHeight, maxHeight)
  const top = Math.min(Math.max(anchorCenter - rowCenter, margin), viewportHeight - margin - height)
  const scrollTop = flyoutHeight > maxHeight ? Math.max(rowCenter - (anchorCenter - top), 0) : 0

  return { top, maxHeight, scrollTop }
}
