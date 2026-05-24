import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReviewListPanel } from '@/components/issue-detail/ReviewListPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReviewIssues: () => ({
    data: [
      {
        id: 'i1',
        title: 'Task A',
        issueNumber: 1,
        statusId: 'working',
        projectId: 'p1',
        projectName: 'Alpha',
        projectAlias: 'alpha',
      },
    ],
    isLoading: false,
  }),
}))

vi.mock('@/hooks/use-review-read-status', () => ({
  useReviewReadStatus: () => ({ markAsRead: vi.fn(), isRead: () => true }),
}))

const toggleProcessManagerMock = vi.fn()
vi.mock('@/stores/process-manager-store', () => ({
  useProcessManagerStore: (selector: (s: { toggle: () => void }) => unknown) =>
    selector({ toggle: toggleProcessManagerMock }),
}))

vi.mock('@/stores/bulk-selection-store', () => ({
  useBulkSelectionStore: (selector?: (s: { selected: Set<string> }) => unknown) => {
    const state = { selected: new Set<string>() }
    if (typeof selector === 'function') return selector(state)
    return state
  },
}))

vi.mock('@/components/issue-detail/BulkOperationsBar', () => ({
  BulkOperationsBar: () => <div data-testid="bulk-bar-stub" />,
}))

describe('reviewListPanel — process manager button (BUG-003 regression)', () => {
  beforeEach(() => {
    toggleProcessManagerMock.mockReset()
  })

  it('renders the process manager button in the header', () => {
    render(
      <ReviewListPanel
        activeIssueId=""
        statuses={['working']}
        onStatusesChange={() => {}}
      />,
    )
    const btn = screen.getByLabelText('processManager.title')
    expect(btn).toBeDefined()
  })

  it('clicking the process manager button toggles the drawer', () => {
    render(
      <ReviewListPanel
        activeIssueId=""
        statuses={['working']}
        onStatusesChange={() => {}}
      />,
    )
    const btn = screen.getByLabelText('processManager.title')
    fireEvent.click(btn)
    expect(toggleProcessManagerMock).toHaveBeenCalled()
  })
})
