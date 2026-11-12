import { create } from 'zustand'
import type { DrawerState } from '@/lib/drawer-store'
import { attachDrawerResize, drawerState } from '@/lib/drawer-store'

const config = { minWidth: 520, defaultRatio: 0.38, maxRatio: 0.6 }

interface NotesStore extends DrawerState {
  selectedNoteId: string | null
  selectNote: (id: string | null) => void
}

export const NOTES_MIN_WIDTH = config.minWidth
export const NOTES_MAX_WIDTH_RATIO = config.maxRatio

export const useNotesStore = create<NotesStore>(set => ({
  ...drawerState(set, config),
  selectedNoteId: null,
  selectNote: id => set({ selectedNoteId: id }),
}))

attachDrawerResize(useNotesStore.getState, config, import.meta.hot)
