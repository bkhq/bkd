import { describe, expect, it } from 'vitest'
import { placeFlyout } from '@/lib/flyout-position'

const base = { viewportHeight: 800, margin: 8 }

describe('placeFlyout', () => {
  it('puts the anchor row level with the hovered icon', () => {
    // Row centre is 114px below the flyout's top; the icon centre is at 400.
    const { top } = placeFlyout({ ...base, anchorCenter: 400, rowCenter: 114, flyoutHeight: 300 })

    expect(top).toBe(400 - 114)
  })

  it('shifts down when aligning would push the flyout above the viewport', () => {
    const { top } = placeFlyout({ ...base, anchorCenter: 40, rowCenter: 114, flyoutHeight: 300 })

    expect(top).toBe(8)
  })

  it('shifts up when aligning would push the flyout below the viewport', () => {
    const { top } = placeFlyout({ ...base, anchorCenter: 780, rowCenter: 114, flyoutHeight: 300 })

    expect(top).toBe(800 - 8 - 300)
  })

  it('does not scroll when the list fits', () => {
    const { scrollTop } = placeFlyout({ ...base, anchorCenter: 400, rowCenter: 114, flyoutHeight: 300 })

    expect(scrollTop).toBe(0)
  })

  it('pins a taller-than-viewport list to the margins and scrolls the row into line', () => {
    // 2000px of content in a 784px window: the anchor row would sit at 1500px.
    const placed = placeFlyout({ ...base, anchorCenter: 400, rowCenter: 1500, flyoutHeight: 2000 })

    expect(placed.top).toBe(8)
    expect(placed.maxHeight).toBe(784)
    // Row centre 1500 should land at 400 - 8 = 392px below the window top.
    expect(placed.scrollTop).toBe(1500 - (400 - 8))
  })

  it('never reports a negative scroll offset', () => {
    const { scrollTop } = placeFlyout({ ...base, anchorCenter: 300, rowCenter: 20, flyoutHeight: 2000 })

    expect(scrollTop).toBe(0)
  })
})
