import { create } from 'zustand'
import { attachResizeClamp } from '@/lib/store-resize'

const MIN_WIDTH = 320
const DEFAULT_WIDTH_RATIO = 0.35
const MAX_WIDTH_RATIO = 0.6

function getViewportWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth
}

function clampWidth(w: number): number {
  const min = MIN_WIDTH
  const max = getViewportWidth() * MAX_WIDTH_RATIO
  return Math.max(min, Math.min(w, max))
}

interface FileBrowserStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  width: number
  projectId: string | null
  /** Issue whose worktree the drawer opens on, when it has one. */
  issueId: string | null
  /** Soft-wrap long lines in the skill editor. */
  wrap: boolean
  close: () => void
  /** Toggle the drawer for a project, opening on the issue's worktree when given. */
  toggleDrawer: (projectId: string, issueId?: string) => void
  minimize: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
  toggleWrap: () => void
}

export { MIN_WIDTH as FILE_BROWSER_MIN_WIDTH }
export const FILE_BROWSER_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useFileBrowserStore = create<FileBrowserStore>(set => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),
  projectId: null,
  issueId: null,
  wrap: false,

  close: () => set({ isOpen: false }),
  toggleDrawer: (projectId, issueId) =>
    set((s) => {
      if (s.isOpen && s.projectId === projectId && s.issueId === (issueId ?? null)) {
        return { isOpen: false }
      }
      return { isOpen: true, isMinimized: false, projectId, issueId: issueId ?? null }
    }),
  minimize: () => set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  toggleFullscreen: () => set(s => ({ isFullscreen: !s.isFullscreen })),
  setWidth: w => set({ width: clampWidth(w) }),
  toggleWrap: () => set(s => ({ wrap: !s.wrap })),
}))

// Re-clamp width on window resize (HMR-safe via import.meta.hot.dispose)
attachResizeClamp(useFileBrowserStore.getState, clampWidth, import.meta.hot)
