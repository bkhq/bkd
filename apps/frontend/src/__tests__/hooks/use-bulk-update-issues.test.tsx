import type { Issue } from '@bkd/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useBulkUpdateIssues } from '@/hooks/use-kanban'

const bulkUpdateIssuesMock = vi.fn()

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    bulkUpdateIssues: (...args: unknown[]) => bulkUpdateIssuesMock(...args),
  },
}))

describe('useBulkUpdateIssues', () => {
  it('stamps statusUpdatedAt on a status change only, so the list reorders before the refetch', async () => {
    const queryClient = new QueryClient()
    const before = '2026-10-01T00:00:00.000Z'
    queryClient.setQueryData(['projects', 'p1', 'issues'], [
      { id: 'a', statusId: 'todo', statusUpdatedAt: before },
      { id: 'b', statusId: 'todo', statusUpdatedAt: before },
    ] as Issue[])
    let resolve: () => void = () => {}
    bulkUpdateIssuesMock.mockReturnValue(new Promise<void>((r) => {
      resolve = r
    }))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useBulkUpdateIssues('p1'), { wrapper })

    act(() => {
      result.current.mutate([{ id: 'a', statusId: 'review' }, { id: 'b', statusId: 'todo', sortOrder: 'a5' }])
    })
    await vi.waitFor(() => {
      const issues = queryClient.getQueryData<Issue[]>(['projects', 'p1', 'issues'])!
      expect(issues[0]!.statusId).toBe('review')
    })
    const issues = queryClient.getQueryData<Issue[]>(['projects', 'p1', 'issues'])!
    expect(issues[0]!.statusUpdatedAt).not.toBe(before)
    expect(issues[1]!.statusUpdatedAt).toBe(before)
    resolve()
  })
})
