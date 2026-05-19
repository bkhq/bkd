import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    listIssueTemplates: vi.fn().mockResolvedValue([
      { id: 'bug-fix', name: 'Bug fix', source: 'builtin' },
    ]),
  },
}))

import { useIssueTemplates } from '@/hooks/use-issue-templates'
import { kanbanApi } from '@/lib/kanban-api'

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useIssueTemplates', () => {
  it('fetches and exposes templates', async () => {
    const { result } = renderHook(() => useIssueTemplates(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.data?.length).toBe(1))
    expect(result.current.data![0].id).toBe('bug-fix')
    expect(kanbanApi.listIssueTemplates).toHaveBeenCalled()
  })
})
