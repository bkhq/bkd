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

const useIsMobileMock = vi.fn(() => true)
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => useIsMobileMock(),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('projectMatrix mobile layout', () => {
  beforeEach(() => {
    useIssueStatsMock.mockReset()
    useIsMobileMock.mockReturnValue(true)
  })

  it('renders card-stack instead of table when on mobile', () => {
    useIssueStatsMock.mockReturnValue({
      data: [
        {
          projectId: 'p1',
          projectName: 'Alpha',
          projectAlias: 'alpha',
          counts: { todo: 2, working: 1, review: 0, done: 5 },
          total: 8,
        },
      ],
      isLoading: false,
    })

    render(<Wrapper><ProjectMatrix /></Wrapper>)

    const card = screen.getByTestId('cockpit-matrix-mobile-card-p1')
    expect(card).toBeDefined()
    // Cards expose the same per-status cells for assertion parity
    expect(within(card).getByTestId('cell-todo').textContent).toContain('2')
    expect(within(card).getByTestId('cell-working').textContent).toContain('1')
    expect(within(card).getByTestId('cell-done').textContent).toContain('5')
  })

  it('does not render the desktop grid row test-id when mobile', () => {
    useIssueStatsMock.mockReturnValue({
      data: [
        {
          projectId: 'p1',
          projectName: 'Alpha',
          projectAlias: 'alpha',
          counts: { todo: 0, working: 0, review: 0, done: 0 },
          total: 0,
        },
      ],
      isLoading: false,
    })

    render(<Wrapper><ProjectMatrix /></Wrapper>)
    expect(screen.queryByTestId('cockpit-matrix-row-p1')).toBeNull()
  })
})
