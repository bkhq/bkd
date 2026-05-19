import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Track in-flight + max concurrent calls to verify the parallelism cap.
let inFlight = 0
let maxInFlight = 0
const calls: string[] = []

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    restartIssue: vi.fn(async (projectId: string, issueId: string) => {
      inFlight++
      if (inFlight > maxInFlight) maxInFlight = inFlight
      calls.push(`restart:${projectId}:${issueId}`)
      // simulate I/O so the parallel test is meaningful
      await new Promise(r => setTimeout(r, 25))
      inFlight--
      return { id: issueId, executionId: 'x' }
    }),
    cancelIssue: vi.fn(async (projectId: string, issueId: string) => {
      calls.push(`cancel:${projectId}:${issueId}`)
      return { id: issueId, status: 'cancelled' }
    }),
    updateIssue: vi.fn(async (projectId: string, issueId: string, patch: Record<string, unknown>) => {
      calls.push(`update:${projectId}:${issueId}:${patch.statusId}`)
      return { id: issueId }
    }),
  },
}))

import { useBulkOperations } from '@/hooks/use-bulk-operations'

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useBulkOperations', () => {
  beforeEach(() => {
    inFlight = 0
    maxInFlight = 0
    calls.length = 0
  })

  it('runs all items via the restart action', async () => {
    const { result } = renderHook(() => useBulkOperations(), { wrapper: Wrapper })
    const items = Array.from({ length: 12 }, (_, i) => ({
      issueId: `i${i}`,
      projectId: 'p1',
    }))
    await act(async () => {
      const r = await result.current.run('restart', items)
      expect(r).toEqual({ done: 12, failed: 0 })
    })
    expect(calls.length).toBe(12)
    expect(new Set(calls).size).toBe(12)
  })

  it('caps concurrency at 5 (the constant in the hook)', async () => {
    const { result } = renderHook(() => useBulkOperations(), { wrapper: Wrapper })
    const items = Array.from({ length: 20 }, (_, i) => ({
      issueId: `i${i}`,
      projectId: 'p1',
    }))
    await act(async () => {
      await result.current.run('restart', items)
    })
    // If parallelism collapses to 1 (the Array.fill bug), maxInFlight === 1.
    // If unlimited, maxInFlight === 20.
    // Correct implementation: max should equal the cap (5), never exceed it.
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(5)
  })

  it('dispatches moveStatus updates with the right statusId', async () => {
    const { result } = renderHook(() => useBulkOperations(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.run(
        'moveStatus',
        [{ issueId: 'i1', projectId: 'p1' }, { issueId: 'i2', projectId: 'p2' }],
        { statusId: 'done' },
      )
    })
    expect(calls).toContain('update:p1:i1:done')
    expect(calls).toContain('update:p2:i2:done')
  })

  it('reports progress correctly when some items fail', async () => {
    const { result } = renderHook(() => useBulkOperations(), { wrapper: Wrapper })
    // Override restartIssue once to throw
    const { kanbanApi } = await import('@/lib/kanban-api') as any
    let i = 0
    kanbanApi.restartIssue.mockImplementation(async () => {
      i++
      if (i === 2) throw new Error('boom')
      return { id: 'x', executionId: 'y' }
    })
    await act(async () => {
      const r = await result.current.run('restart', [
        { issueId: 'a', projectId: 'p' },
        { issueId: 'b', projectId: 'p' },
        { issueId: 'c', projectId: 'p' },
      ])
      expect(r.done).toBe(2)
      expect(r.failed).toBe(1)
    })
    await waitFor(() => expect(result.current.isRunning).toBe(false))
  })

  it('returns zero counts on empty items', async () => {
    const { result } = renderHook(() => useBulkOperations(), { wrapper: Wrapper })
    await act(async () => {
      const r = await result.current.run('restart', [])
      expect(r).toEqual({ done: 0, failed: 0 })
    })
  })
})
