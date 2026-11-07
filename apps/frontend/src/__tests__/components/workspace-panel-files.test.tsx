import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { WorkspacePanel } from '@/components/issue-detail/WorkspacePanel'
import { useWorkspacePanelStore } from '@/stores/workspace-panel-store'

const mocks = vi.hoisted(() => ({
  changes: { isLoading: true, isError: false, data: undefined as unknown, refetch: vi.fn() },
}))

vi.mock('@/hooks/use-kanban', () => ({
  useIssueChanges: () => mocks.changes,
}))
vi.mock('@/hooks/use-changes-summary', () => ({ useChangesSummary: () => null }))
vi.mock('@/components/files/WorkspaceFiles', () => ({
  WorkspaceFiles: ({ projectId, issueId }: { projectId: string, issueId: string }) => <div>{`file manager ${projectId}/${issueId}`}</div>,
}))

function renderPanel() {
  return render(<WorkspacePanel projectId="p1" issueId="i1" width={400} onWidthChange={() => {}} />)
}

describe('workspace panel Files tab', () => {
  beforeEach(async () => {
    mocks.changes = { isLoading: true, isError: false, data: undefined, refetch: vi.fn() }
    useWorkspacePanelStore.setState({ isOpen: true })
    await i18n.changeLanguage('en')
  })

  it('waits for the issue workspace instead of falling back to the main checkout', () => {
    renderPanel()
    expect(screen.queryByText(/file manager/)).not.toBeInTheDocument()
  })

  it('opens the file manager on the issue once its workspace is known', () => {
    mocks.changes = { isLoading: false, isError: false, data: { root: '/wt/i1', gitRepo: true, files: [] }, refetch: vi.fn() }
    renderPanel()
    expect(screen.getByText('file manager p1/i1')).toBeInTheDocument()
  })

  it('refuses to open the main checkout while the issue has no worktree', () => {
    mocks.changes = { isLoading: false, isError: false, data: { root: '/main/checkout', worktreeMissing: true, gitRepo: true, files: [] }, refetch: vi.fn() }
    renderPanel()
    expect(screen.queryByText(/file manager/)).not.toBeInTheDocument()
    expect(screen.getByText(/has no worktree yet, or it was cleaned up/)).toBeInTheDocument()
  })

  it('keeps the panel width when the Files tab shows', () => {
    useWorkspacePanelStore.setState({ width: 400 })
    renderPanel()
    expect(useWorkspacePanelStore.getState().width).toBe(400)
  })

  it('shows an error with retry when the workspace cannot be resolved', () => {
    mocks.changes = { isLoading: false, isError: true, data: undefined, refetch: vi.fn() }
    renderPanel()
    expect(screen.queryByText(/file manager/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.changes.refetch).toHaveBeenCalled()
  })
})

describe('workspace panel layout', () => {
  beforeEach(async () => {
    mocks.changes = { isLoading: false, isError: false, data: { root: '/wt/i1', gitRepo: true, files: [] }, refetch: vi.fn() }
    useWorkspacePanelStore.setState({ isOpen: true, isMaximized: false })
    await i18n.changeLanguage('en')
  })

  it('is one file manager with no tabs: changes are reviewed inside it', () => {
    renderPanel()
    expect(screen.getByText('file manager p1/i1')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
  })
})

describe('workspace panel hide control', () => {
  beforeEach(async () => {
    mocks.changes = { isLoading: true, isError: false, data: undefined, refetch: vi.fn() }
    useWorkspacePanelStore.setState({ isOpen: true, isMaximized: false })
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
