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

interface ProcessManagerStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  width: number
  open: () => void
  close: () => void
  toggle: () => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
}

export { MIN_WIDTH as PROCESS_MANAGER_MIN_WIDTH }
export const PROCESS_MANAGER_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useProcessManagerStore = create<ProcessManagerStore>(set => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),

  open: () => set({ isOpen: true, isMinimized: false }),
  close: () => set({ isOpen: false }),
  toggle: () =>
    set((s) => {
      if (s.isMinimized) return { isOpen: true, isMinimized: false }
      if (s.isOpen) return { isOpen: false }
      return { isOpen: true }
    }),
  minimize: () => set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  restore: () => set({ isOpen: true, isMinimized: false }),
  toggleFullscreen: () => set(s => ({ isFullscreen: !s.isFullscreen })),
  setWidth: w => set({ width: clampWidth(w) }),
}))

// Re-clamp width on window resize (HMR-safe via import.meta.hot.dispose)
attachResizeClamp(useProcessManagerStore.getState, clampWidth, import.meta.hot)

// Per-field selectors to avoid full re-renders
export const useProcessManagerOpen = () => useProcessManagerStore(s => s.isOpen)
export const useProcessManagerMinimized = () => useProcessManagerStore(s => s.isMinimized)
export const useProcessManagerFullscreen = () => useProcessManagerStore(s => s.isFullscreen)
export const useProcessManagerWidth = () => useProcessManagerStore(s => s.width)
