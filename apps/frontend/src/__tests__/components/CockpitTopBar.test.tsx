import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addRecentIssue, clearRecentIssues } from '@/hooks/use-recent-issues'

import { CockpitTopBar } from '@/components/cockpit/CockpitTopBar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const useProjectsMock = vi.fn(() => ({
  data: [{ id: 'p1', name: 'Alpha Project', alias: 'alpha' }],
}))
const updateIssueMutate = vi.fn()
vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProjects: () => useProjectsMock(),
  useIssue: () => ({ data: undefined }),
  useUpdateIssue: () => ({ mutate: updateIssueMutate, isPending: false }),
}))

const openCreateMock = vi.fn()
vi.mock('@/stores/panel-store', () => ({
  usePanelStore: (selector: (s: { openCreateDialog: () => void }) => unknown) =>
    selector({ openCreateDialog: openCreateMock }),
}))

const toggleProcessManagerMock = vi.fn()
vi.mock('@/stores/process-manager-store', () => ({
  useProcessManagerStore: (selector: (s: { toggle: () => void }) => unknown) =>
    selector({ toggle: toggleProcessManagerMock }),
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/components/ProjectSettingsDialog', () => ({
  ProjectSettingsDialog: ({
    open,
    project,
  }: { open: boolean, project: { name: string } }) =>
    open ? <div data-testid="project-settings-stub">{project.name}</div> : null,
}))

function Wrap({
  children,
  initialPath = '/review',
}: { children: React.ReactNode, initialPath?: string }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/review" element={children} />
        <Route path="/review/:projectAlias/:issueId" element={children} />
      </Routes>
    </MemoryRouter>
  )
}

describe('cockpitTopBar', () => {
  beforeEach(() => {
    clearRecentIssues()
    navigateMock.mockReset()
    openCreateMock.mockReset()
    toggleProcessManagerMock.mockReset()
    updateIssueMutate.mockReset()
  })
  afterEach(() => clearRecentIssues())

  it('renders the home button + cockpit label on the empty path', () => {
    render(<Wrap><CockpitTopBar /></Wrap>)
    expect(screen.getByTestId('cockpit-topbar')).toBeDefined()
    expect(screen.getByTestId('cockpit-topbar-home')).toBeDefined()
    expect(screen.getByText(/Cockpit/i)).toBeDefined()
    // No project breadcrumb yet
    expect(screen.queryByTestId('cockpit-topbar-project')).toBeNull()
  })

  it('home button navigates to /review', () => {
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-home'))
    expect(navigateMock).toHaveBeenCalledWith('/review')
  })

  it('renders project breadcrumb + gear when URL has a project', () => {
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    expect(screen.getByTestId('cockpit-topbar-project')).toBeDefined()
    expect(screen.getByText('Alpha Project')).toBeDefined()
    expect(screen.getByTestId('cockpit-topbar-project-settings')).toBeDefined()
  })

  it('gear opens the project settings dialog', async () => {
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-project-settings'))
    // Lazy-loaded — wait for the dialog stub to appear
    const dialog = await screen.findByTestId('project-settings-stub')
    expect(dialog.textContent).toBe('Alpha Project')
  })

  it('renders issue summary when the recent-issues store has the current issue', () => {
    addRecentIssue({
      id: 'i1',
      title: 'Refactor auth flow',
      issueNumber: 12,
      projectAlias: 'alpha',
      projectName: 'Alpha Project',
      statusId: 'working',
    })
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    expect(screen.getByText('Refactor auth flow')).toBeDefined()
    expect(screen.getByText(/12/)).toBeDefined()
  })

  it('+ button opens the create dialog with projectId when in project context', () => {
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-new'))
    expect(openCreateMock).toHaveBeenCalledWith(undefined, 'p1')
  })

  it('+ button opens the create dialog without projectId when no project context', () => {
    render(<Wrap><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-new'))
    expect(openCreateMock).toHaveBeenCalledWith(undefined, undefined)
  })

  it('renders the process manager button', () => {
    render(<Wrap><CockpitTopBar /></Wrap>)
    expect(screen.getByTestId('cockpit-topbar-processes')).toBeDefined()
  })

  it('process manager button toggles the process manager drawer', () => {
    render(<Wrap><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-processes'))
    expect(toggleProcessManagerMock).toHaveBeenCalled()
  })

  // ── inline title edit (moved from ChatArea's title bar) ─────────────

  function seedIssue() {
    addRecentIssue({
      id: 'i1',
      title: 'Refactor auth flow',
      issueNumber: 12,
      projectAlias: 'alpha',
      projectName: 'Alpha Project',
      statusId: 'working',
    })
  }

  it('clicking the breadcrumb title swaps it for an input prefilled with the title', () => {
    seedIssue()
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-title'))
    const input = screen.getByTestId('cockpit-topbar-title-input') as HTMLInputElement
    expect(input.value).toBe('Refactor auth flow')
  })

  it('pressing Enter on the title input commits the change via useUpdateIssue', () => {
    seedIssue()
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-title'))
    const input = screen.getByTestId('cockpit-topbar-title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New title' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateIssueMutate).toHaveBeenCalledWith({ id: 'i1', title: 'New title' })
    // After save the input is gone; the button is back.
    expect(screen.queryByTestId('cockpit-topbar-title-input')).toBeNull()
    expect(screen.getByTestId('cockpit-topbar-title')).toBeDefined()
  })

  it('pressing Escape cancels editing without calling the mutation', () => {
    seedIssue()
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-title'))
    const input = screen.getByTestId('cockpit-topbar-title-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'never persisted' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(updateIssueMutate).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cockpit-topbar-title-input')).toBeNull()
  })

  it('does not call mutate when the title is unchanged', () => {
    seedIssue()
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    fireEvent.click(screen.getByTestId('cockpit-topbar-title'))
    const input = screen.getByTestId('cockpit-topbar-title-input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateIssueMutate).not.toHaveBeenCalled()
  })

  // ── copy-link button (moved from ChatArea's title bar) ───────────────

  it('renders the copy-link button when an issue is in context', () => {
    seedIssue()
    render(<Wrap initialPath="/review/alpha/i1"><CockpitTopBar /></Wrap>)
    expect(screen.getByTestId('cockpit-topbar-copy-link')).toBeDefined()
  })

  it('does NOT render the copy-link button without an issue context', () => {
    render(<Wrap initialPath="/review"><CockpitTopBar /></Wrap>)
    expect(screen.queryByTestId('cockpit-topbar-copy-link')).toBeNull()
  })

  it('⌥← jumps to the previous recent issue when one is open', () => {
    addRecentIssue({
      id: 'i1',
      title: 'A',
      issueNumber: 1,
      projectAlias: 'alpha',
      projectName: 'Alpha Project',
      statusId: 'working',
    })
    addRecentIssue({
      id: 'i2',
      title: 'B',
      issueNumber: 2,
      projectAlias: 'alpha',
      projectName: 'Alpha Project',
      statusId: 'working',
    })
    // Recent is most-recent-first: [i2, i1]
    // current = i2 (head), ⌥← goes deeper into history → i1
    render(<Wrap initialPath="/review/alpha/i2"><CockpitTopBar /></Wrap>)
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })
    expect(navigateMock).toHaveBeenCalledWith('/review/alpha/i1')
  })
})
