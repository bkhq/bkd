/**
 * Regression for the ⌘K `#N` shortcut: typing `#12` should rank issue #12
 * at the top of the Review group instead of relying on title fuzzy matches.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { SearchContent } from '@/components/search/SearchContent'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProjects: () => ({ data: [{ id: 'p1', name: 'Alpha', alias: 'alpha' }] }),
  useAllProcesses: () => ({ data: { processes: [] } }),
  useReviewIssues: () => ({
    data: [
      {
        id: 'a',
        title: 'Refactor login form',
        issueNumber: 11,
        projectName: 'Alpha',
        projectAlias: 'alpha',
        statusUpdatedAt: '2026-05-19T00:00:00.000Z',
      },
      {
        id: 'b',
        title: 'Fix JWT bug',
        issueNumber: 12,
        projectName: 'Alpha',
        projectAlias: 'alpha',
        statusUpdatedAt: '2026-05-19T00:00:00.000Z',
      },
      {
        id: 'c',
        title: 'Add tests',
        issueNumber: 120,
        projectName: 'Alpha',
        projectAlias: 'alpha',
        statusUpdatedAt: '2026-05-19T00:00:00.000Z',
      },
    ],
  }),
  queryKeys: { logSearch: (q: string) => ['logs', q] },
}))

vi.mock('@/stores/terminal-store', () => ({
  useTerminalStore: Object.assign(
    () => ({ openFullscreen: vi.fn() }),
    { getState: () => ({ openFullscreen: vi.fn() }) },
  ),
}))

vi.mock('@/stores/view-mode-store', () => ({
  useViewModeStore: () => (alias: string) => `/projects/${alias}`,
}))

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: { searchLogs: vi.fn().mockResolvedValue([]) },
}))

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('searchContent — #N shortcut', () => {
  it('typing #12 narrows the Review group to issueNumber=12 only', () => {
    render(<Wrap><SearchContent onSelect={() => {}} /></Wrap>)
    const input = screen.getByPlaceholderText(/搜索|search/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '#12' } })
    // #12 visible
    expect(screen.getByText('Fix JWT bug')).toBeDefined()
    // #11 and #120 hidden
    expect(screen.queryByText('Refactor login form')).toBeNull()
    expect(screen.queryByText('Add tests')).toBeNull()
  })

  it('typing partial title "Refactor" still matches fuzzily', () => {
    render(<Wrap><SearchContent onSelect={() => {}} /></Wrap>)
    const input = screen.getByPlaceholderText(/搜索|search/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'refactor' } })
    expect(screen.getByText('Refactor login form')).toBeDefined()
    expect(screen.queryByText('Fix JWT bug')).toBeNull()
  })
})
