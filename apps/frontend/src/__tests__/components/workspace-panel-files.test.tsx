import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { WorkspacePanel } from '@/components/issue-detail/WorkspacePanel'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store'

const mocks = vi.hoisted(() => ({
  changes: { isLoading: true, isError: false, data: undefined as unknown, refetch: vi.fn() },
}))

vi.mock('@/hooks/use-kanban', () => ({
  useIssueChanges: () => mocks.changes,
  useProject: () => ({ data: { id: 'p1', name: 'Proj', directory: '/main/checkout' } }),
  useProjectFiles: () => ({ data: undefined }),
}))
vi.mock('@/hooks/use-changes-summary', () => ({ useChangesSummary: () => null }))
vi.mock('@/components/files/FileBrowserContent', () => ({
  FileBrowserContent: () => <div>file browser</div>,
}))
vi.mock('@/components/issue-detail/DiffPanel', () => ({ DiffChanges: () => null }))

function renderPanel() {
  return render(<WorkspacePanel projectId="p1" issueId="i1" width={400} onWidthChange={() => {}} />)
}

describe('workspace panel Files tab', () => {
  beforeEach(async () => {
    mocks.changes = { isLoading: true, isError: false, data: undefined, refetch: vi.fn() }
    useWorkspacePanelStore.setState({ isOpen: true, tabs: ['files'], activeTab: 'files' })
    useFileBrowserStore.setState({ isOpen: false, isDrawer: true, projectId: null, issueId: null, rootPath: null })
    await i18n.changeLanguage('en')
  })

  it('waits for the issue workspace instead of falling back to the main checkout', () => {
    renderPanel()
    expect(screen.queryByText('file browser')).not.toBeInTheDocument()
    expect(useFileBrowserStore.getState().issueId).toBeNull()
  })

  it('binds to the issue worktree once known', () => {
    mocks.changes = { isLoading: false, isError: false, data: { root: '/wt/i1', gitRepo: true, files: [] }, refetch: vi.fn() }
    renderPanel()
    const fb = useFileBrowserStore.getState()
    expect([fb.issueId, fb.rootPath, fb.isDrawer]).toEqual(['i1', '/wt/i1', false])
    expect(screen.getByText('file browser')).toBeInTheDocument()
  })

  it('refuses to open the main checkout while the issue has no worktree', () => {
    mocks.changes = { isLoading: false, isError: false, data: { root: '/main/checkout', worktreeMissing: true, gitRepo: true, files: [] }, refetch: vi.fn() }
    renderPanel()
    expect(screen.queryByText('file browser')).not.toBeInTheDocument()
    expect(useFileBrowserStore.getState().issueId).toBeNull()
    expect(screen.getByText(/has no worktree yet, or it was cleaned up/)).toBeInTheDocument()
  })

  it('shows an error with retry when the workspace cannot be resolved', () => {
    mocks.changes = { isLoading: false, isError: true, data: undefined, refetch: vi.fn() }
    renderPanel()
    expect(screen.queryByText('file browser')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.changes.refetch).toHaveBeenCalled()
  })

  it('does not show the drawer\'s context while the drawer owns the browser', () => {
    mocks.changes = { isLoading: false, isError: false, data: { root: '/wt/i1', gitRepo: true, files: [] }, refetch: vi.fn() }
    useFileBrowserStore.setState({ isOpen: true, isDrawer: true, projectId: 'p1', issueId: null, rootPath: '/main/checkout' })
    renderPanel()
    expect(screen.queryByText('file browser')).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open here' }))
    })
    expect(useFileBrowserStore.getState().rootPath).toBe('/wt/i1')
    expect(screen.getByText('file browser')).toBeInTheDocument()
  })
})

describe('workspace panel hide control', () => {
  beforeEach(async () => {
    mocks.changes = { isLoading: true, isError: false, data: undefined, refetch: vi.fn() }
    useWorkspacePanelStore.setState({ isOpen: true, tabs: ['files'], activeTab: 'files', isMaximized: false })
    await i18n.changeLanguage('en')
  })

  it('leaves hiding the inline panel to the chat area\'s fixed toggle', () => {
    renderPanel()
    // The toggle stays in one place whether the panel is open or closed, so the
    // inline panel must not render a second one that would appear and vanish.
    expect(screen.queryByRole('button', { name: 'Hide side panel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Maximize workspace' })).toBeInTheDocument()
  })

  it('keeps its own hide button in fullscreen, where nothing else can close it', () => {
    render(<WorkspacePanel projectId="p1" issueId="i1" width={0} onWidthChange={() => {}} fullScreen />)
    expect(screen.getByRole('button', { name: 'Hide side panel' })).toBeInTheDocument()
  })
})
