import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIssueChanges } from '@/hooks/use-kanban'
import type { IssueEventHandler } from '@/lib/event-bus'

const getIssueChangesMock = vi.fn()
const handlers = new Map<string, IssueEventHandler>()

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    getIssueChanges: (...args: unknown[]) => getIssueChangesMock(...args),
  },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    subscribe: (issueId: string, handler: IssueEventHandler) => {
      handlers.set(issueId, handler)
      return () => handlers.delete(issueId)
    },
  },
}))

const missing = { root: '/main/checkout', worktreeMissing: true, gitRepo: true, files: [], additions: 0, deletions: 0 }
const present = { root: '/wt/i1', gitRepo: true, files: [], additions: 0, deletions: 0 }

function renderChanges() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useIssueChanges('p1', 'i1'), { wrapper })
}

describe('useIssueChanges', () => {
  beforeEach(() => {
    getIssueChangesMock.mockReset()
    handlers.clear()
  })

  it('looks again once a run starts on an issue whose worktree does not exist yet', async () => {
    getIssueChangesMock.mockResolvedValueOnce(missing).mockResolvedValue(present)
    const { result } = renderChanges()
    await waitFor(() => expect(result.current.data?.worktreeMissing).toBe(true))

    // The run creates the worktree before its process reports anything
    act(() => handlers.get('i1')!.onLog({} as never))
    await waitFor(() => expect(result.current.data?.root).toBe('/wt/i1'))
    expect(handlers.has('i1')).toBe(false)
  })

  it('does not watch runs while the worktree exists', async () => {
    getIssueChangesMock.mockResolvedValue(present)
    const { result } = renderChanges()
    await waitFor(() => expect(result.current.data?.root).toBe('/wt/i1'))
    expect(handlers.has('i1')).toBe(false)
  })
})
