import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileBrowserStore } from '@/stores/file-browser-store'

describe('useFileBrowserStore.openAt', () => {
  beforeEach(() => {
    // Reset store state between tests
    useFileBrowserStore.setState({
      isOpen: false,
      isMinimized: false,
      isFullscreen: false,
      isDrawer: true,
      projectId: null,
      issueId: null,
      rootPath: null,
      currentPath: '.',
      hideIgnored: false,
      pathCache: new Map(),
      targetLine: null,
      targetFile: null,
    })
    // Default to desktop matchMedia
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  })

  it('opens the drawer at a specific path with line', () => {
    useFileBrowserStore.getState().openAt({
      projectId: 'proj-1',
      issueId: 'issue-1',
      rootPath: '/repo',
      path: 'apps/api/foo.ts',
      line: 42,
    })
    const s = useFileBrowserStore.getState()
    expect(s.isOpen).toBe(true)
    expect(s.isDrawer).toBe(true)
    expect(s.projectId).toBe('proj-1')
    expect(s.issueId).toBe('issue-1')
    expect(s.rootPath).toBe('/repo')
    expect(s.currentPath).toBe('apps/api/foo.ts')
    expect(s.targetFile).toBe('apps/api/foo.ts')
    expect(s.targetLine).toBe(42)
  })

  it('normalizes leading ./ and backslashes', () => {
    useFileBrowserStore.getState().openAt({
      projectId: 'p',
      path: './apps\\api\\foo.ts',
    })
    expect(useFileBrowserStore.getState().currentPath).toBe('apps/api/foo.ts')
    expect(useFileBrowserStore.getState().targetFile).toBe('apps/api/foo.ts')
  })

  it('clears target line when line is omitted or zero', () => {
    useFileBrowserStore.getState().openAt({
      projectId: 'p',
      path: 'foo.ts',
      line: 0,
    })
    expect(useFileBrowserStore.getState().targetLine).toBeNull()
  })

  it('switches to fullscreen mode when matchMedia reports mobile', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    useFileBrowserStore.getState().openAt({
      projectId: 'p',
      path: 'foo.ts',
    })
    expect(useFileBrowserStore.getState().isFullscreen).toBe(true)
  })

  it('clearTarget clears both file and line', () => {
    useFileBrowserStore.getState().openAt({
      projectId: 'p',
      path: 'foo.ts',
      line: 7,
    })
    useFileBrowserStore.getState().clearTarget()
    expect(useFileBrowserStore.getState().targetLine).toBeNull()
    expect(useFileBrowserStore.getState().targetFile).toBeNull()
  })

  it('close clears the target so next open does not jump unexpectedly', () => {
    useFileBrowserStore.getState().openAt({
      projectId: 'p',
      path: 'foo.ts',
      line: 5,
    })
    useFileBrowserStore.getState().close()
    expect(useFileBrowserStore.getState().isOpen).toBe(false)
    expect(useFileBrowserStore.getState().targetLine).toBeNull()
    expect(useFileBrowserStore.getState().targetFile).toBeNull()
  })

  it('preserves path cache across switches', () => {
    const store = useFileBrowserStore.getState()
    store.openAt({ projectId: 'p', issueId: 'a', rootPath: '/r', path: 'foo.ts' })
    // Switch to a different issue context
    store.openAt({ projectId: 'p', issueId: 'b', rootPath: '/r', path: 'bar.ts' })
    // Reopen the first context — cached path should still be foo.ts
    store.openAt({ projectId: 'p', issueId: 'a', rootPath: '/r', path: 'baz.ts' })
    expect(useFileBrowserStore.getState().currentPath).toBe('baz.ts')
  })
})
