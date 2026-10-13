import { create } from 'zustand'

/** Width of the file-tree pane (review and files tabs share it), persisted. */
const KEY = 'bkd-tree-width'
const DEFAULT_WIDTH = 224
export const TREE_PANE_MIN_WIDTH = 160
export const TREE_PANE_MAX_WIDTH = 480

function clamp(w: number): number {
  return Math.round(Math.max(TREE_PANE_MIN_WIDTH, Math.min(w, TREE_PANE_MAX_WIDTH)))
}

function loadWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const stored = Number(localStorage.getItem(KEY))
  return stored ? clamp(stored) : DEFAULT_WIDTH
}

interface TreePaneStore {
  width: number
  setWidth: (w: number) => void
}

export const useTreePaneStore = create<TreePaneStore>(set => ({
  width: loadWidth(),
  setWidth: (w) => {
    const width = clamp(w)
    localStorage.setItem(KEY, String(width))
    set({ width })
  },
}))
