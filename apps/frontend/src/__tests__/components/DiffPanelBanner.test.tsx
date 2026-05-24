import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DiffPanel } from '@/components/issue-detail/DiffPanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ resolved: 'light' }),
}))

const useChangesMock = vi.fn()
vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIssueChanges: (...args: unknown[]) => useChangesMock(...args),
  useIssueAiChanges: () => ({
    data: { onDisk: [], reverted: [], dirtyNotTouched: [], gitRepo: true, timedOut: false, root: '/tmp/p' },
    isLoading: false,
    isError: false,
  }),
  useIssueAiTimeline: () => ({ data: null, isLoading: false, isError: false }),
  useIssueFilePatch: () => ({ data: undefined, isLoading: false, isError: false }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('diffPanel shared-workspace banner', () => {
  beforeEach(() => {
    useChangesMock.mockReset()
    useChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        files: [{ path: 'a.ts', type: 'modified', additions: 1, deletions: 0 }],
        additions: 1,
        deletions: 0,
      },
    })
  })

  it('shows banner when useWorktree=false (shared workspace)', () => {
    render(
      <Wrapper>
        <DiffPanel
          projectId="p"
          issueId="i"
          width={360}
          onWidthChange={() => {}}
          onClose={() => {}}
          useWorktree={false}
        />
      </Wrapper>,
    )
    expect(screen.getByTestId('diff-shared-workspace-banner')).toBeDefined()
  })

  it('hides banner when useWorktree=true (isolated worktree)', () => {
    render(
      <Wrapper>
        <DiffPanel
          projectId="p"
          issueId="i"
          width={360}
          onWidthChange={() => {}}
          onClose={() => {}}
          useWorktree={true}
        />
      </Wrapper>,
    )
    expect(screen.queryByTestId('diff-shared-workspace-banner')).toBeNull()
  })

  it('hides banner when useWorktree is undefined (unknown — fail safe)', () => {
    render(
      <Wrapper>
        <DiffPanel
          projectId="p"
          issueId="i"
          width={360}
          onWidthChange={() => {}}
          onClose={() => {}}
        />
      </Wrapper>,
    )
    expect(screen.queryByTestId('diff-shared-workspace-banner')).toBeNull()
  })
})
