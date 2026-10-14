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

/** Unsaved editor content plus the on-disk version it started from. */
export interface FileDraft {
  content: string
  baseModifiedAt: string
}

function draftKey(root: string, path: string): string {
  return `${root}\n${path}`
}

/** Build a cache key for per-context path persistence. */
function contextKey(projectId: string, rootPath: string | null, issueId?: string | null): string {
  if (issueId) return `${projectId}:issue:${issueId}`
  return rootPath ? `${projectId}:${rootPath}` : projectId
}

interface FileBrowserStore {
  isOpen: boolean
  isMinimized: boolean
  isFullscreen: boolean
  /** Whether the current view is a drawer (true) or inline panel (false). */
  isDrawer: boolean
  width: number
  projectId: string | null
  issueId: string | null
  rootPath: string | null
  currentPath: string
  hideIgnored: boolean
  /** Directory tree beside the file view (open by default). */
  showTree: boolean
  /** Soft-wrap long lines in the file editor. */
  wrap: boolean
  /**
   * Unsaved edits by workspace root + path. Kept in the store so they survive
   * the browser unmounting (tab closed, panel hidden) and never leak between
   * worktrees that share a relative path.
   */
  drafts: Record<string, FileDraft>
  /** Per-context path cache so switching contexts restores the last position. */
  pathCache: Map<string, string>
  open: (projectId: string, rootPath?: string) => void
  /** Bind to a specific issue — tracks path per issue, shown in the workspace panel. */
  openForIssue: (projectId: string, issueId: string, rootPath?: string) => void
  openFullscreen: (projectId: string, rootPath?: string) => void
  close: () => void
  toggle: (projectId: string) => void
  /** Toggle as drawer (global overlay). */
  toggleDrawer: (projectId: string, rootPath?: string) => void
  minimize: () => void
  restore: () => void
  toggleFullscreen: () => void
  setWidth: (w: number) => void
  navigateTo: (path: string) => void
  toggleHideIgnored: () => void
  toggleTree: () => void
  toggleWrap: () => void
  setDraft: (root: string, path: string, draft: FileDraft | null) => void
  /** Drop drafts of `path` and everything inside it (a deleted file or directory). */
  clearDraftsUnder: (root: string, path: string) => void
}

export { MIN_WIDTH as FILE_BROWSER_MIN_WIDTH }
export const FILE_BROWSER_MAX_WIDTH_RATIO = MAX_WIDTH_RATIO

/**
 * Save current path to cache and resolve the path for a new context.
 * Returns the cached path or '.' if the context is new.
 */
function switchContext(
  s: FileBrowserStore,
  projectId: string,
  rootPath: string | null,
  issueId?: string | null,
): { currentPath: string, pathCache: Map<string, string> } {
  const newKey = contextKey(projectId, rootPath, issueId)
  const oldKey = s.projectId ? contextKey(s.projectId, s.rootPath, s.issueId) : null

  // Same context — keep current path, no cache update needed
  if (oldKey === newKey) {
    return { currentPath: s.currentPath, pathCache: s.pathCache }
  }

  // Save current path for the old context
  const cache = new Map(s.pathCache)
  if (oldKey) cache.set(oldKey, s.currentPath)

  // Restore cached path for the new context
  return { currentPath: cache.get(newKey) ?? '.', pathCache: cache }
}

export const useFileBrowserStore = create<FileBrowserStore>(set => ({
  isOpen: false,
  isMinimized: false,
  isFullscreen: false,
  isDrawer: true,
  width: Math.round(getViewportWidth() * DEFAULT_WIDTH_RATIO),
  projectId: null,
  issueId: null,
  rootPath: null,
  currentPath: '.',
  hideIgnored: false,
  showTree: true,
  wrap: false,
  drafts: {},
  pathCache: new Map(),

  open: (projectId, rootPath) =>
    set((s) => {
      const ctx = switchContext(s, projectId, rootPath ?? null)
      return {
        isOpen: true,
        isMinimized: false,
        isDrawer: true,
        projectId,
        issueId: null,
        rootPath: rootPath ?? null,
        ...ctx,
      }
    }),
  openForIssue: (projectId, issueId, rootPath) =>
    set((s) => {
      const ctx = switchContext(s, projectId, rootPath ?? null, issueId)
      return {
        isOpen: true,
        isMinimized: false,
        isDrawer: false,
        projectId,
        issueId,
        rootPath: rootPath ?? null,
        ...ctx,
      }
    }),
  openFullscreen: (projectId, rootPath) =>
    set((s) => {
      const ctx = switchContext(s, projectId, rootPath ?? null)
      return {
        isOpen: true,
        isMinimized: false,
        isFullscreen: true,
        isDrawer: true,
        projectId,
        issueId: null,
        rootPath: rootPath ?? null,
        ...ctx,
      }
    }),
  close: () => set({ isOpen: false }),
  toggle: projectId =>
    set((s) => {
      if (s.isMinimized) {
        const ctx = switchContext(s, projectId, s.projectId === projectId ? s.rootPath : null)
        return {
          isOpen: true,
          isMinimized: false,
          isDrawer: true,
          projectId,
          issueId: null,
          rootPath: s.projectId === projectId ? s.rootPath : null,
          ...ctx,
        }
      }
      if (s.isOpen && s.projectId === projectId) {
        return { isOpen: false }
      }
      const newRoot = s.projectId === projectId ? s.rootPath : null
      const ctx = switchContext(s, projectId, newRoot)
      return {
        isOpen: true,
        isDrawer: true,
        projectId,
        issueId: null,
        rootPath: newRoot,
        ...ctx,
      }
    }),
  toggleDrawer: (projectId, rootPath) =>
    set((s) => {
      if (s.isOpen && s.isDrawer && s.projectId === projectId) {
        return { isOpen: false }
      }
      const effectiveRoot = rootPath ?? (s.projectId === projectId ? s.rootPath : null)
      const ctx = switchContext(s, projectId, effectiveRoot)
      return {
        isOpen: true,
        isMinimized: false,
        isDrawer: true,
        issueId: null,
        projectId,
        rootPath: effectiveRoot,
        ...ctx,
      }
    }),
  minimize: () => set({ isOpen: false, isMinimized: true, isFullscreen: false }),
  restore: () => set({ isOpen: true, isMinimized: false }),
  toggleFullscreen: () => set(s => ({ isFullscreen: !s.isFullscreen })),
  setWidth: w => set({ width: clampWidth(w) }),
  navigateTo: path => set({ currentPath: path }),
  toggleHideIgnored: () => set(s => ({ hideIgnored: !s.hideIgnored })),
  toggleTree: () => set(s => ({ showTree: !s.showTree })),
  toggleWrap: () => set(s => ({ wrap: !s.wrap })),
  setDraft: (root, path, draft) =>
    set((s) => {
      const drafts = { ...s.drafts }
      if (draft) drafts[draftKey(root, path)] = draft
      else delete drafts[draftKey(root, path)]
      return { drafts }
    }),
  clearDraftsUnder: (root, path) =>
    set((s) => {
      const self = draftKey(root, path)
      const drafts = Object.fromEntries(
        Object.entries(s.drafts).filter(([key]) => key !== self && !key.startsWith(`${self}/`)),
      )
      return { drafts }
    }),
}))

export function selectDraft(s: FileBrowserStore, root: string, path: string): FileDraft | null {
  return s.drafts[draftKey(root, path)] ?? null
}

// Unsaved drafts may belong to a browser that is no longer on screen; let the
// browser's leave-page prompt cover them.
if (typeof window !== 'undefined') {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (Object.keys(useFileBrowserStore.getState().drafts).length > 0) e.preventDefault()
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  import.meta.hot?.dispose(() => window.removeEventListener('beforeunload', onBeforeUnload))
}

// Re-clamp width on window resize (HMR-safe via import.meta.hot.dispose)
attachResizeClamp(useFileBrowserStore.getState, clampWidth, import.meta.hot)

// Per-field selectors to avoid full re-renders
export const useFileBrowserOpen = () => useFileBrowserStore(s => s.isOpen)
export const useFileBrowserMinimized = () => useFileBrowserStore(s => s.isMinimized)
export const useFileBrowserFullscreen = () => useFileBrowserStore(s => s.isFullscreen)
export const useFileBrowserIsDrawer = () => useFileBrowserStore(s => s.isDrawer)
export const useFileBrowserWidth = () => useFileBrowserStore(s => s.width)
export const useFileBrowserCurrentPath = () => useFileBrowserStore(s => s.currentPath)
export const useFileBrowserHideIgnored = () => useFileBrowserStore(s => s.hideIgnored)
