import { describe, expect, it } from 'vitest'
import { shouldHideListPanel } from '@/lib/list-panel'

const base = { isMobile: false, issueId: 'i1', panelOpen: false, panelWidth: 400, availableWidth: 1200 }

describe('shouldHideListPanel', () => {
  it('hides the list on mobile while an issue is open', () => {
    expect(shouldHideListPanel({ ...base, isMobile: true })).toBe(true)
  })

  it('hides the list when the open workspace panel takes over half the width', () => {
    expect(shouldHideListPanel({ ...base, panelOpen: true, panelWidth: 700 })).toBe(true)
    expect(shouldHideListPanel({ ...base, panelOpen: true, panelWidth: 500 })).toBe(false)
  })

  it('keeps the list when no issue is selected, whatever the panel state', () => {
    expect(shouldHideListPanel({ ...base, issueId: '', panelOpen: true, panelWidth: 900 })).toBe(false)
    expect(shouldHideListPanel({ ...base, issueId: '', isMobile: true, panelOpen: true })).toBe(false)
  })
})
