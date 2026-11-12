import { create } from 'zustand'
import { ratioClamp } from '@/lib/drawer-store'
import { attachResizeClamp } from '@/lib/store-resize'

/**
 * Width of the local-session transcript drawer. Kept in a store (like
 * `panel-store` and `file-browser-store`) so a width the user drags survives
 * closing and reopening the drawer.
 */
const MIN_WIDTH = 420
const DEFAULT_WIDTH_RATIO = 0.55
const MAX_WIDTH_RATIO = 0.9

const clampWidth = ratioClamp(MIN_WIDTH, MAX_WIDTH_RATIO)

interface SessionPanelStore {
  width: number
  isFullscreen: boolean
  setWidth: (w: number) => void
  toggleFullscreen: () => void
}

export { MIN_WIDTH as SESSION_PANEL_MIN_WIDTH }
export const SESSION_PANEL_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useSessionPanelStore = create<SessionPanelStore>(set => ({
  width: Math.round((typeof window === 'undefined' ? 1024 : window.innerWidth) * DEFAULT_WIDTH_RATIO),
  isFullscreen: false,
  setWidth: w => set({ width: clampWidth(w) }),
  toggleFullscreen: () => set(s => ({ isFullscreen: !s.isFullscreen })),
}))

// Re-clamp width on window resize (HMR-safe via import.meta.hot.dispose)
attachResizeClamp(useSessionPanelStore.getState, clampWidth, import.meta.hot)
