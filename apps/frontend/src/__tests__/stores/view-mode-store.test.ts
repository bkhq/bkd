import { beforeEach, describe, expect, it } from 'vitest'
import { useViewModeStore } from '@/stores/view-mode-store'

describe('view-mode-store renderMarkdown', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the rendered view and persists the choice', () => {
    expect(useViewModeStore.getState().renderMarkdown).toBe(true)
    useViewModeStore.getState().setRenderMarkdown(false)
    expect(useViewModeStore.getState().renderMarkdown).toBe(false)
    expect(localStorage.getItem('bkd-render-markdown')).toBe('false')
  })
})
