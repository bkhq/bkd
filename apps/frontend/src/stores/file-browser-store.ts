import { create } from 'zustand'

const MIN_WIDTH = 320
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
  projectId: string | null
  rootPath: string | null
  currentPath: string
  hideIgnored: boolean
  open: (projectId: string, rootPath?: string) => void
  close: () => void
  toggle: (projectId: string) => void
  setWidth: (w: number) => void
  navigateTo: (path: string) => void
  toggleHideIgnored: () => void
}

export { MIN_WIDTH as FILE_BROWSER_MIN_WIDTH }
export const FILE_BROWSER_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

export const useFileBrowserStore = create<FileBrowserStore>(set => ({
  isOpen: false,
  projectId: null,
  rootPath: null,
  currentPath: '.',
  hideIgnored: false,

  open: (projectId, rootPath) =>
    set(s => ({
      isOpen: true,
      projectId,
      rootPath: rootPath ?? null,
      currentPath:
        s.projectId === projectId && s.rootPath === (rootPath ?? null) ? s.currentPath : '.',
    })),
  close: () => set({ isOpen: false }),
  toggle: projectId =>
    set((s) => {
      if (s.isOpen && s.projectId === projectId) {
        return { isOpen: false }
      }
      return {
        isOpen: true,
        projectId,
        rootPath: s.projectId === projectId ? s.rootPath : null,
        currentPath: s.projectId === projectId ? s.currentPath : '.',
      }
    }),
  setWidth: w => set({ width: clampWidth(w) } as Partial<FileBrowserStore>),
  navigateTo: path => set({ currentPath: path }),
  toggleHideIgnored: () => set(s => ({ hideIgnored: !s.hideIgnored })),
}))
