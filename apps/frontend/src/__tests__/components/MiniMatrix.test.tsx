import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useViewModeStore } from '@/stores/view-mode-store'

import { MiniMatrix } from '@/components/cockpit/MiniMatrix'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const useIssueStatsMock = vi.fn()
vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIssueStats: () => useIssueStatsMock(),
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

function Wrap({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('miniMatrix', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    useIssueStatsMock.mockReset()
    useViewModeStore.setState({ miniMatrixCollapsed: false })
    useIssueStatsMock.mockReturnValue({
      data: [
        {
          projectId: 'p1',
          projectName: 'Alpha',
          projectAlias: 'alpha',
          counts: { todo: 2, working: 1, review: 0, done: 5 },
          total: 8,
        },
        {
          projectId: 'p2',
          projectName: 'Beta',
          projectAlias: 'beta',
          counts: { todo: 0, working: 0, review: 3, done: 1 },
          total: 4,
        },
      ],
    })
  })

  it('renders a row per project with status cells', () => {
    render(<Wrap><MiniMatrix /></Wrap>)
    expect(screen.getByTestId('mini-matrix')).toBeDefined()
    expect(screen.getByTestId('mini-matrix-row-p1')).toBeDefined()
    expect(screen.getByTestId('mini-matrix-row-p2')).toBeDefined()
    expect(screen.getByTestId('mini-matrix-cell-p1-working').textContent).toBe('1')
    expect(screen.getByTestId('mini-matrix-cell-p2-review').textContent).toBe('3')
  })

  it('clicking a status cell navigates with the right status filter', () => {
    render(<Wrap><MiniMatrix /></Wrap>)
    fireEvent.click(screen.getByTestId('mini-matrix-cell-p1-working'))
    expect(navigateMock).toHaveBeenCalledWith('/projects/alpha?status=working')
  })

  it('clicking the project name navigates to the project page (no status)', () => {
    render(<Wrap><MiniMatrix /></Wrap>)
    fireEvent.click(screen.getByText('Alpha'))
    expect(navigateMock).toHaveBeenCalledWith('/projects/alpha')
  })

  it('collapsing via the toggle renders nothing (no floating button)', () => {
    render(<Wrap><MiniMatrix /></Wrap>)
    fireEvent.click(screen.getByTestId('mini-matrix-collapse'))
    expect(useViewModeStore.getState().miniMatrixCollapsed).toBe(true)
    expect(screen.queryByTestId('mini-matrix')).toBeNull()
    expect(screen.queryByTestId('mini-matrix-collapsed')).toBeNull()
  })

  it('renders nothing while collapsed', () => {
    useViewModeStore.setState({ miniMatrixCollapsed: true })
    const { container } = render(<Wrap><MiniMatrix /></Wrap>)
    expect(container.firstChild).toBeNull()
  })

  it('returns null when there are no projects', () => {
    useIssueStatsMock.mockReturnValue({ data: [] })
    const { container } = render(<Wrap><MiniMatrix /></Wrap>)
    expect(container.firstChild).toBeNull()
  })
})
