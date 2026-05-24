import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CockpitQuickCreate } from '@/components/cockpit/CockpitQuickCreate'

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
  queryKeys: { issues: () => ['x'], issueStats: () => ['y'] },
}))

vi.mock('@/hooks/use-issue-templates', () => ({
  useIssueTemplates: () => ({ data: [] }),
}))

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: { createIssue: vi.fn() },
}))

const useIsMobileMock = vi.fn()
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => useIsMobileMock(),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('cockpitQuickCreate responsive', () => {
  beforeEach(() => {
    useIsMobileMock.mockReset()
  })

  it('mobile open renders the bottom sheet container, not the desktop popover', () => {
    useIsMobileMock.mockReturnValue(true)
    render(<Wrapper><CockpitQuickCreate /></Wrapper>)
    fireEvent.click(screen.getByTestId('cockpit-quick-create-trigger'))
    expect(screen.getByTestId('cockpit-quick-create-sheet')).toBeDefined()
    expect(screen.queryByTestId('cockpit-quick-create-popover')).toBeNull()
  })

  it('desktop open renders the popover, not the sheet', () => {
    useIsMobileMock.mockReturnValue(false)
    render(<Wrapper><CockpitQuickCreate /></Wrapper>)
    fireEvent.click(screen.getByTestId('cockpit-quick-create-trigger'))
    expect(screen.getByTestId('cockpit-quick-create-popover')).toBeDefined()
    expect(screen.queryByTestId('cockpit-quick-create-sheet')).toBeNull()
  })
})
