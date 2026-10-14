import { create } from 'zustand'

/** Review diff display preferences, persisted across sessions. */
export type DiffStyle = 'unified' | 'split'

interface DiffViewStore {
  diffStyle: DiffStyle
  setDiffStyle: (style: DiffStyle) => void
  wrap: boolean
  setWrap: (value: boolean) => void
  /** Changed-file tree beside the review list. */
  showTree: boolean
  toggleTree: () => void
}

const STYLE_KEY = 'bkd-diff-style'
const WRAP_KEY = 'bkd-diff-wrap'
const TREE_KEY = 'bkd-diff-tree'

function loadStyle(): DiffStyle {
  if (typeof window === 'undefined') return 'unified'
  return localStorage.getItem(STYLE_KEY) === 'split' ? 'split' : 'unified'
}

function loadWrap(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(WRAP_KEY) !== 'false'
}

export const useDiffViewStore = create<DiffViewStore>((set, get) => ({
  diffStyle: loadStyle(),
  setDiffStyle: (diffStyle) => {
    localStorage.setItem(STYLE_KEY, diffStyle)
    set({ diffStyle })
  },
  wrap: loadWrap(),
  setWrap: (wrap) => {
    localStorage.setItem(WRAP_KEY, String(wrap))
    set({ wrap })
  },
  showTree: typeof window !== 'undefined' && localStorage.getItem(TREE_KEY) === 'true',
  toggleTree: () => {
    const showTree = !get().showTree
    localStorage.setItem(TREE_KEY, String(showTree))
    set({ showTree })
  },
}))
