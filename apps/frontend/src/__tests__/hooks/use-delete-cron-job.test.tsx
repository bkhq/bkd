import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeleteCronJob } from '@/hooks/use-kanban'

const deleteCronJobMock = vi.fn()

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    deleteCronJob: (...args: unknown[]) => deleteCronJobMock(...args),
  },
}))

describe('useDeleteCronJob', () => {
  beforeEach(() => {
    deleteCronJobMock.mockReset()
  })

  it('invalidates the cron job list after deletion', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    deleteCronJobMock.mockResolvedValue({ deleted: true, name: 'cleanup' })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDeleteCronJob(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('cron-1')
    })

    expect(deleteCronJobMock).toHaveBeenCalledWith('cron-1')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['cron', 'jobs'] })
  })
})
