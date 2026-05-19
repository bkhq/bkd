import { create } from 'zustand'

interface BulkSelectionState {
  selected: Set<string>
  toggle: (id: string) => void
  setMany: (ids: string[], on: boolean) => void
  clear: () => void
  isSelected: (id: string) => boolean
}

export const useBulkSelectionStore = create<BulkSelectionState>((set, get) => ({
  selected: new Set<string>(),
  toggle: id =>
    set((s) => {
      const next = new Set(s.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selected: next }
    }),
  setMany: (ids, on) =>
    set((s) => {
      const next = new Set(s.selected)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return { selected: next }
    }),
  clear: () => set({ selected: new Set() }),
  isSelected: id => get().selected.has(id),
}))
