import { beforeEach, describe, expect, it } from 'vitest'
import { useTreePaneStore } from '@/stores/tree-pane-store'

describe('tree-pane-store', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to 224px', () => {
    expect(useTreePaneStore.getInitialState().width).toBe(224)
  })

  it('clamps and persists the width', () => {
    useTreePaneStore.getState().setWidth(1000)
    expect(useTreePaneStore.getState().width).toBe(480)
    useTreePaneStore.getState().setWidth(50)
    expect(useTreePaneStore.getState().width).toBe(160)
    expect(localStorage.getItem('bkd-tree-width')).toBe('160')
  })
})
