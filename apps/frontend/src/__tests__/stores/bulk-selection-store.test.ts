import { beforeEach, describe, expect, it } from 'vitest'
import { useBulkSelectionStore } from '@/stores/bulk-selection-store'

describe('bulkSelectionStore', () => {
  beforeEach(() => useBulkSelectionStore.getState().clear())

  it('starts empty', () => {
    expect(useBulkSelectionStore.getState().selected.size).toBe(0)
  })

  it('toggle adds then removes an id', () => {
    const s = useBulkSelectionStore.getState()
    s.toggle('a')
    expect(useBulkSelectionStore.getState().selected.has('a')).toBe(true)
    expect(useBulkSelectionStore.getState().isSelected('a')).toBe(true)
    s.toggle('a')
    expect(useBulkSelectionStore.getState().selected.has('a')).toBe(false)
  })

  it('setMany on=true adds all', () => {
    useBulkSelectionStore.getState().setMany(['a', 'b', 'c'], true)
    const sel = useBulkSelectionStore.getState().selected
    expect(sel.size).toBe(3)
    expect(sel.has('b')).toBe(true)
  })

  it('setMany on=false removes selected ids only', () => {
    useBulkSelectionStore.getState().setMany(['a', 'b', 'c'], true)
    useBulkSelectionStore.getState().setMany(['b'], false)
    const sel = useBulkSelectionStore.getState().selected
    expect(sel.has('a')).toBe(true)
    expect(sel.has('b')).toBe(false)
    expect(sel.has('c')).toBe(true)
  })

  it('clear empties everything', () => {
    useBulkSelectionStore.getState().setMany(['a', 'b'], true)
    useBulkSelectionStore.getState().clear()
    expect(useBulkSelectionStore.getState().selected.size).toBe(0)
  })
})
