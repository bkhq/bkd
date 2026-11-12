import { attachResizeClamp } from '@/lib/store-resize'

export interface DrawerState {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  width: number
  open: () => void
  openFullscreen: () => void
  close: () => void
  toggle: () => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
}

interface DrawerConfig {
  minWidth: number
  /** Share of the viewport the drawer opens at. */
  defaultRatio: number
  /** Share of the viewport the drawer may grow to. */
  maxRatio: number
}

type SetDrawer = (partial: Partial<DrawerState> | ((s: DrawerState) => Partial<DrawerState>)) => void

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth
}

/** Clamp a width between `minWidth` and `maxRatio` of the viewport. */
export function ratioClamp(minWidth: number, maxRatio: number): (w: number) => number {
  return w => Math.max(minWidth, Math.min(w, viewportWidth() * maxRatio))
}

/** State and actions shared by the resizable side drawers. */
export function drawerState(set: SetDrawer, { minWidth, defaultRatio, maxRatio }: DrawerConfig): DrawerState {
  const clampWidth = ratioClamp(minWidth, maxRatio)
  return {
    isOpen: false,
    isMinimized: false,
    isFullscreen: false,
    width: Math.round(viewportWidth() * defaultRatio),

    open: () => set({ isOpen: true, isMinimized: false }),
    openFullscreen: () => set({ isOpen: true, isMinimized: false, isFullscreen: true }),
    close: () => set({ isOpen: false }),
    toggle: () => set(s => (s.isMinimized ? { isOpen: true, isMinimized: false } : { isOpen: !s.isOpen })),
    minimize: () => set({ isOpen: false, isMinimized: true, isFullscreen: false }),
    restore: () => set({ isOpen: true, isMinimized: false }),
    toggleFullscreen: () => set(s => ({ isFullscreen: !s.isFullscreen })),
    setWidth: w => set({ width: clampWidth(w) }),
  }
}

/** Re-clamp a drawer store's width when the window resizes (HMR-safe). */
export function attachDrawerResize(
  getState: () => { width: number, setWidth: (w: number) => void },
  { minWidth, maxRatio }: Pick<DrawerConfig, 'minWidth' | 'maxRatio'>,
  hot?: { dispose: (cb: () => void) => void },
): void {
  attachResizeClamp(getState, ratioClamp(minWidth, maxRatio), hot)
}
