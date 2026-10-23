import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDeleteIssue } from '@/hooks/use-kanban'

const deleteIssueMock = vi.fn()

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    deleteIssue: (...args: unknown[]) => deleteIssueMock(...args),
  },
}))

describe('useDeleteIssue', () => {
  it('refreshes the review queue too: a deleted issue may be listed there', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    deleteIssueMock.mockResolvedValue({ deleted: true })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDeleteIssue('p1'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('i1')
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['projects', 'p1', 'issues'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['issues', 'review'] })
  })
})
