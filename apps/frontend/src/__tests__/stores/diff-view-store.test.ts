import { beforeEach, describe, expect, it } from 'vitest'
import { useDiffViewStore } from '@/stores/diff-view-store'

describe('diff-view-store', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to a stacked, wrapped diff', () => {
    const initial = useDiffViewStore.getInitialState()
    expect(initial.diffStyle).toBe('unified')
    expect(initial.wrap).toBe(true)
    expect(initial.showTree).toBe(false)
  })

  it('persists the file tree toggle', () => {
    useDiffViewStore.getState().toggleTree()
    expect(useDiffViewStore.getState().showTree).toBe(true)
    expect(localStorage.getItem('bkd-diff-tree')).toBe('true')
  })

  it('persists the chosen style and wrap', () => {
    useDiffViewStore.getState().setDiffStyle('split')
    useDiffViewStore.getState().setWrap(false)
    expect(useDiffViewStore.getState().diffStyle).toBe('split')
    expect(useDiffViewStore.getState().wrap).toBe(false)
    expect(localStorage.getItem('bkd-diff-style')).toBe('split')
    expect(localStorage.getItem('bkd-diff-wrap')).toBe('false')
  })
})
