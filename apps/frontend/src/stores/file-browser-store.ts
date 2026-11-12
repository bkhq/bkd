import { create } from 'zustand'
import type { DrawerState } from '@/lib/drawer-store'
import { attachDrawerResize, drawerState } from '@/lib/drawer-store'

const config = { minWidth: 320, defaultRatio: 0.35, maxRatio: 0.6 }

interface FileBrowserStore extends DrawerState {
  projectId: string | null
  /** Issue whose worktree the drawer opens on, when it has one. */
  issueId: string | null
  /** Toggle the drawer for a project, opening on the issue's worktree when given. */
  toggleDrawer: (projectId: string, issueId?: string) => void
}

export const FILE_BROWSER_MIN_WIDTH = config.minWidth
export const FILE_BROWSER_MAX_WIDTH_RATIO = config.maxRatio

export const useFileBrowserStore = create<FileBrowserStore>(set => ({
  ...drawerState(set, config),
  projectId: null,
  issueId: null,

  toggleDrawer: (projectId, issueId) =>
    set((s) => {
      if (s.isOpen && s.projectId === projectId && s.issueId === (issueId ?? null)) {
        return { isOpen: false }
      }
      return { isOpen: true, isMinimized: false, projectId, issueId: issueId ?? null }
    }),
}))

attachDrawerResize(useFileBrowserStore.getState, config, import.meta.hot)
