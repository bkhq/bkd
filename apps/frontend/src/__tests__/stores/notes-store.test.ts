import { beforeEach, describe, expect, it } from 'vitest'
import { useNotesStore } from '@/stores/notes-store'

describe('notes-store list width', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to 224px', () => {
    expect(useNotesStore.getInitialState().listWidth).toBe(224)
  })

  it('clamps and persists the list width', () => {
    useNotesStore.getState().setListWidth(1000)
    expect(useNotesStore.getState().listWidth).toBe(400)
    useNotesStore.getState().setListWidth(50)
    expect(useNotesStore.getState().listWidth).toBe(160)
    expect(localStorage.getItem('bkd-notes-list-width')).toBe('160')
  })
})
