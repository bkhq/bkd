import { create } from 'zustand'

/**
 * Right-side workspace panel of the issue chat: one panel, one width, with
 * closable tabs. It starts with no tabs, where it shows a launcher; closing
 * the last tab hides the panel.
 */
export type WorkspaceTab = 'files' | 'review'

/** Display order of the tabs, whichever order they were opened in. */
const TAB_ORDER: WorkspaceTab[] = ['files', 'review']
const MIN_WIDTH = 320
const DEFAULT_WIDTH = 400
/** ensureWidth never takes more than this share of the viewport. */
const ENSURE_MAX_VIEWPORT_RATIO = 0.6

interface WorkspacePanelStore {
  isOpen: boolean
  /** Panel fills the chat area; reset whenever the panel hides. */
  isMaximized: boolean
  tabs: WorkspaceTab[]
  activeTab: WorkspaceTab | null
  width: number
  /** Show or hide the panel, keeping its tabs. */
  togglePanel: () => void
  /** Open (if needed) and activate `tab`, showing the panel. */
  openTab: (tab: WorkspaceTab) => void
  /** Hide the panel if `tab` is already showing, otherwise open and activate it. */
  toggleTab: (tab: WorkspaceTab) => void
  setActiveTab: (tab: WorkspaceTab) => void
  toggleMaximized: () => void
  closeTab: (tab: WorkspaceTab) => void
  hide: () => void
  setWidth: (w: number) => void
  /** Widen to at least `min` (capped to the viewport share); never narrows. */
  ensureWidth: (min: number) => void
}

export { MIN_WIDTH as WORKSPACE_PANEL_MIN_WIDTH }

export const useWorkspacePanelStore = create<WorkspacePanelStore>(set => ({
  isOpen: false,
  isMaximized: false,
  tabs: [],
  activeTab: null,
  width: DEFAULT_WIDTH,

  togglePanel: () => set(s => (s.isOpen ? { isOpen: false, isMaximized: false } : { isOpen: true })),
  openTab: tab =>
    set(s => ({
      isOpen: true,
      tabs: s.tabs.includes(tab) ? s.tabs : TAB_ORDER.filter(t => t === tab || s.tabs.includes(t)),
      activeTab: tab,
    })),
  toggleTab: (tab) => {
    const s = useWorkspacePanelStore.getState()
    if (s.isOpen && s.activeTab === tab) set({ isOpen: false, isMaximized: false })
    else s.openTab(tab)
  },
  setActiveTab: tab => set({ activeTab: tab }),
  toggleMaximized: () => set(s => ({ isMaximized: !s.isMaximized })),
  closeTab: tab =>
    set((s) => {
      const index = s.tabs.indexOf(tab)
      if (index === -1) return {}
      const tabs = s.tabs.filter(t => t !== tab)
      if (tabs.length === 0) return { isOpen: false, isMaximized: false, tabs, activeTab: null }
      const activeTab = s.activeTab === tab ? tabs[Math.min(index, tabs.length - 1)] : s.activeTab
      return { tabs, activeTab }
    }),
  hide: () => set({ isOpen: false, isMaximized: false }),
  setWidth: w => set({ width: Math.max(MIN_WIDTH, w) }),
  ensureWidth: min =>
    set((s) => {
      const target = Math.min(min, Math.round(window.innerWidth * ENSURE_MAX_VIEWPORT_RATIO))
      return target > s.width ? { width: target } : {}
    }),
}))
