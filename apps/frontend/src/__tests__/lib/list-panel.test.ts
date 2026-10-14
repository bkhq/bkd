import { describe, expect, it } from 'vitest'
import { shouldHideListPanel } from '@/lib/list-panel'

const base = { isMobile: false, issueId: 'i1', panelOpen: false, panelWidth: 400, availableWidth: 1200, listMinWidth: 180, minChatWidth: 300 }

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

  it('hides the list when list minimum + panel would push the chat below its minimum', () => {
    // 900px window minus the 56px rail: 844 - 400 - 180 leaves 264px of chat
    expect(shouldHideListPanel({ ...base, panelOpen: true, panelWidth: 400, availableWidth: 844 })).toBe(true)
    // 1000px window: 944 - 400 - 180 leaves 364px, enough
    expect(shouldHideListPanel({ ...base, panelOpen: true, panelWidth: 400, availableWidth: 944 })).toBe(false)
  })
})
