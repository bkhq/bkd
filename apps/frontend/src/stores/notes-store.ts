import { create } from 'zustand'
import type { DrawerState } from '@/lib/drawer-store'
import { attachDrawerResize, drawerState } from '@/lib/drawer-store'

const config = { minWidth: 520, defaultRatio: 0.38, maxRatio: 0.6 }

/** Width of the note list beside the editor, persisted. */
const LIST_WIDTH_KEY = 'bkd-notes-list-width'
const DEFAULT_LIST_WIDTH = 224
export const NOTES_LIST_MIN_WIDTH = 160
export const NOTES_LIST_MAX_WIDTH = 400

function clampListWidth(w: number): number {
  return Math.round(Math.max(NOTES_LIST_MIN_WIDTH, Math.min(w, NOTES_LIST_MAX_WIDTH)))
}

function loadListWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_LIST_WIDTH
  const stored = Number(localStorage.getItem(LIST_WIDTH_KEY))
  return stored ? clampListWidth(stored) : DEFAULT_LIST_WIDTH
}

interface NotesStore extends DrawerState {
  listWidth: number
  selectedNoteId: string | null
  setListWidth: (w: number) => void
  selectNote: (id: string | null) => void
}

export const NOTES_MIN_WIDTH = config.minWidth
export const NOTES_MAX_WIDTH_RATIO = config.maxRatio

export const useNotesStore = create<NotesStore>(set => ({
  ...drawerState(set, config),
  listWidth: loadListWidth(),
  selectedNoteId: null,
  setListWidth: (w) => {
    const listWidth = clampListWidth(w)
    localStorage.setItem(LIST_WIDTH_KEY, String(listWidth))
    set({ listWidth })
  },
  selectNote: id => set({ selectedNoteId: id }),
}))

attachDrawerResize(useNotesStore.getState, config, import.meta.hot)
