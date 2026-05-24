import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectMatrix } from '@/components/cockpit/ProjectMatrix'

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

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('projectMatrix', () => {
  beforeEach(() => {
    useIssueStatsMock.mockReset()
  })

  it('renders a row per project with counts for each status', () => {
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
      isLoading: false,
    })

    render(<Wrapper><ProjectMatrix /></Wrapper>)

    const alphaRow = screen.getByTestId('cockpit-matrix-row-p1')
    expect(within(alphaRow).getByTestId('cell-todo').textContent).toBe('2')
    expect(within(alphaRow).getByTestId('cell-working').textContent).toBe('1')
    expect(within(alphaRow).getByTestId('cell-review').textContent).toBe('0')
    expect(within(alphaRow).getByTestId('cell-done').textContent).toBe('5')

    const betaRow = screen.getByTestId('cockpit-matrix-row-p2')
    expect(within(betaRow).getByTestId('cell-review').textContent).toBe('3')
  })

  it('renders empty state when no projects', () => {
    useIssueStatsMock.mockReturnValue({ data: [], isLoading: false })
    render(<Wrapper><ProjectMatrix /></Wrapper>)
    expect(screen.getByTestId('cockpit-matrix-empty')).toBeDefined()
  })

  it('shows loading skeleton when loading', () => {
    useIssueStatsMock.mockReturnValue({ data: undefined, isLoading: true })
    render(<Wrapper><ProjectMatrix /></Wrapper>)
    expect(screen.getByTestId('cockpit-matrix-loading')).toBeDefined()
  })
})
