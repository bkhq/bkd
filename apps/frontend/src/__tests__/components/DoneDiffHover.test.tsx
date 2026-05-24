import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DoneDiffHover } from '@/components/kanban/DoneDiffHover'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const useChangesMock = vi.fn()
vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIssueChanges: (...args: unknown[]) => useChangesMock(...args),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('doneDiffHover', () => {
  beforeEach(() => {
    useChangesMock.mockReset()
  })

  it('does not fetch until hovered (passes enabled=false initially)', () => {
    useChangesMock.mockReturnValue({ data: undefined, isLoading: false, isError: false })
    render(
      <Wrapper>
        <DoneDiffHover projectId="p1" issueId="i1">
          <div>card</div>
        </DoneDiffHover>
      </Wrapper>,
    )
    // Hook called with enabled = false at first render
    const lastCall = useChangesMock.mock.calls.at(-1)
    expect(lastCall?.[2]).toBe(false)
  })

  it('hovering opens the popover and renders file rows', () => {
    useChangesMock.mockReturnValue({
      data: {
        root: '/r',
        gitRepo: true,
        files: [
          { path: 'src/a.ts', type: 'modified', additions: 12, deletions: 3 },
          { path: 'src/b.ts', type: 'added', additions: 5, deletions: 0 },
        ],
        additions: 17,
        deletions: 3,
      },
      isLoading: false,
      isError: false,
    })
    render(
      <Wrapper>
        <DoneDiffHover projectId="p1" issueId="i1">
          <div>card</div>
        </DoneDiffHover>
      </Wrapper>,
    )
    fireEvent.mouseEnter(screen.getByTestId('done-diff-hover-trigger-i1'))
    expect(screen.getByTestId('done-diff-hover-file-src/a.ts')).toBeDefined()
    expect(screen.getByTestId('done-diff-hover-file-src/b.ts')).toBeDefined()
  })
})
