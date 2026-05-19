import { create } from 'zustand'

type ViewMode = 'kanban' | 'list'

interface ViewModeStore {
  mode: ViewMode
  setMode: (mode: ViewMode) => void
  projectPath: (projectId: string) => string
  fullWidthChat: boolean
  setFullWidthChat: (value: boolean) => void
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  listPanelCollapsed: boolean
  toggleListPanel: () => void
  setListPanelCollapsed: (value: boolean) => void
  miniMatrixCollapsed: boolean
  toggleMiniMatrix: () => void
}

const STORAGE_KEY = 'bkd-view-mode'
const FULL_WIDTH_KEY = 'bkd-full-width-chat'
const SIDEBAR_COLLAPSED_KEY = 'bkd-sidebar-collapsed'
const LIST_PANEL_COLLAPSED_KEY = 'bkd-list-panel-collapsed'
const MINI_MATRIX_COLLAPSED_KEY = 'bkd-mini-matrix-collapsed'

function loadMode(): ViewMode {
  if (typeof window === 'undefined') return 'list'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'kanban') return stored
  return 'list'
}

function loadFullWidth(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(FULL_WIDTH_KEY) === 'true'
}

function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
}

function loadListPanelCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(LIST_PANEL_COLLAPSED_KEY) === 'true'
}

function loadMiniMatrixCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(MINI_MATRIX_COLLAPSED_KEY) === 'true'
}

export const useViewModeStore = create<ViewModeStore>((set, get) => ({
  mode: loadMode(),

  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    set({ mode })
  },

  projectPath: (projectId) => {
    const m = get().mode
    if (m === 'list') return `/projects/${projectId}/issues`
    return `/projects/${projectId}`
  },

  fullWidthChat: loadFullWidth(),

  setFullWidthChat: (value) => {
    localStorage.setItem(FULL_WIDTH_KEY, String(value))
    set({ fullWidthChat: value })
  },

  sidebarCollapsed: loadSidebarCollapsed(),

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
    set({ sidebarCollapsed: next })
  },

  listPanelCollapsed: loadListPanelCollapsed(),

  toggleListPanel: () => {
    const next = !get().listPanelCollapsed
    localStorage.setItem(LIST_PANEL_COLLAPSED_KEY, String(next))
    set({ listPanelCollapsed: next })
  },

  setListPanelCollapsed: (value) => {
    localStorage.setItem(LIST_PANEL_COLLAPSED_KEY, String(value))
    set({ listPanelCollapsed: value })
  },

  miniMatrixCollapsed: loadMiniMatrixCollapsed(),

  toggleMiniMatrix: () => {
    const next = !get().miniMatrixCollapsed
    localStorage.setItem(MINI_MATRIX_COLLAPSED_KEY, String(next))
    set({ miniMatrixCollapsed: next })
  },
}))
