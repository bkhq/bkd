import { beforeEach, describe, expect, it } from 'vitest'
import { useViewModeStore } from '@/stores/view-mode-store'

describe('view-mode-store renderMarkdown', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the source view and persists the choice', () => {
    expect(useViewModeStore.getState().renderMarkdown).toBe(false)
    useViewModeStore.getState().setRenderMarkdown(true)
    expect(useViewModeStore.getState().renderMarkdown).toBe(true)
    expect(localStorage.getItem('bkd-render-markdown')).toBe('true')
  })
})
