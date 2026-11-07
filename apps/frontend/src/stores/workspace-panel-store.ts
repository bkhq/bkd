import { create } from 'zustand'
import { attachResizeClamp } from '@/lib/store-resize'

const MIN_WIDTH = 320
/** Width the panel opens at, however it is opened. */
const DEFAULT_WIDTH = 400
/** The default never takes more than this share of the viewport. */
const DEFAULT_MAX_VIEWPORT_RATIO = 0.6
/** App rail plus the chat's minimum width, which the panel must leave free. */
const RESERVED_WIDTH = 56 + 300

function clampWidth(w: number): number {
  const viewport = typeof window === 'undefined' ? 1600 : window.innerWidth
  return Math.max(MIN_WIDTH, Math.min(w, viewport - RESERVED_WIDTH))
}

/**
 * Right-side workspace panel of the issue chat: the file manager over the
 * issue's workspace, where changes are browsed and reviewed alike.
 */
interface WorkspacePanelStore {
  isOpen: boolean
  /** Panel fills the chat area; reset whenever the panel hides. */
  isMaximized: boolean
  width: number
  togglePanel: () => void
  toggleMaximized: () => void
  hide: () => void
  setWidth: (w: number) => void
}

function defaultWidth(): number {
  const viewport = typeof window === 'undefined' ? 1600 : window.innerWidth
  return clampWidth(Math.min(DEFAULT_WIDTH, Math.round(viewport * DEFAULT_MAX_VIEWPORT_RATIO)))
}

export { MIN_WIDTH as WORKSPACE_PANEL_MIN_WIDTH }

export const useWorkspacePanelStore = create<WorkspacePanelStore>(set => ({
  isOpen: false,
  isMaximized: false,
  width: defaultWidth(),

  togglePanel: () => set(s => (s.isOpen ? { isOpen: false, isMaximized: false } : { isOpen: true })),
  toggleMaximized: () => set(s => ({ isMaximized: !s.isMaximized })),
  hide: () => set({ isOpen: false, isMaximized: false }),
  setWidth: w => set({ width: clampWidth(w) }),
}))

// Re-clamp when the window narrows (HMR-safe via import.meta.hot.dispose)
attachResizeClamp(useWorkspacePanelStore.getState, clampWidth, import.meta.hot)
