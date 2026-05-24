/**
 * DiffPanel Slice-C layout: AI section is primary, git diff is folded into
 * a "工作区其它脏文件" collapsible that excludes AI-touched files (no
 * duplication).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
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
const useAiChangesMock = vi.fn()
vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIssueChanges: (...args: unknown[]) => useChangesMock(...args),
  useIssueAiChanges: (...args: unknown[]) => useAiChangesMock(...args),
  useIssueAiTimeline: () => ({ data: null, isLoading: false, isError: false }),
  useIssueFilePatch: () => ({ data: undefined, isLoading: false, isError: false }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('diffPanel slice-C layout', () => {
  beforeEach(() => {
    useChangesMock.mockReset()
    useAiChangesMock.mockReset()
  })

  it('shows git-other section only for files not in AI onDisk', () => {
    useChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        files: [
          { path: 'src/a.ts', type: 'modified', additions: 5, deletions: 1 },
          { path: 'bun.lockb', type: 'modified', additions: 0, deletions: 0 },
        ],
        additions: 5,
        deletions: 1,
      },
    })
    useAiChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        timedOut: false,
        // a.ts is AI-touched, bun.lockb is not
        onDisk: [{
          path: 'src/a.ts',
          rawPath: 'src/a.ts',
          toolName: 'Edit',
          editCount: 1,
          firstTurnIndex: 0,
          lastTurnIndex: 0,
          lastTouchAt: '2026-05-19T00:00:00.000Z',
          status: 'edited',
        }],
        reverted: [],
        dirtyNotTouched: ['bun.lockb'],
      },
    })
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
    // AI section is present + a.ts is in it
    expect(screen.getByTestId('diff-ai-attributed-section').textContent).toContain('src/a.ts')
    // Git-other section header shows (1) — only bun.lockb, NOT a.ts
    const other = screen.getByTestId('diff-git-other-section')
    expect(other).toBeDefined()
    expect(other.textContent).toContain('(1)')
    expect(other.textContent).not.toContain('src/a.ts')
  })

  it('git-other section starts collapsed', () => {
    useChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        files: [{ path: 'bun.lockb', type: 'modified', additions: 0, deletions: 0 }],
        additions: 0,
        deletions: 0,
      },
    })
    useAiChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        timedOut: false,
        onDisk: [{
          path: 'src/a.ts',
          rawPath: 'src/a.ts',
          toolName: 'Edit',
          editCount: 1,
          firstTurnIndex: 0,
          lastTurnIndex: 0,
          lastTouchAt: '2026-05-19T00:00:00.000Z',
          status: 'edited',
        }],
        reverted: [],
        dirtyNotTouched: ['bun.lockb'],
      },
    })
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
    const other = screen.getByTestId('diff-git-other-section')
    // Body not expanded: no file card visible
    expect(other.querySelector('details')).toBeNull()
    // Click header expands
    const header = other.querySelector('button')!
    fireEvent.click(header)
    expect(other.querySelector('details')).toBeDefined()
  })

  it('shows "not a git repo" hint when gitRepo=false but AI still has rows', () => {
    useChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: false,
        files: [],
        additions: 0,
        deletions: 0,
      },
    })
    useAiChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: false,
        timedOut: false,
        onDisk: [{
          path: 'a.ts',
          rawPath: 'a.ts',
          toolName: 'Edit',
          editCount: 1,
          firstTurnIndex: 0,
          lastTurnIndex: 0,
          lastTouchAt: '2026-05-19T00:00:00.000Z',
          status: 'edited',
        }],
        reverted: [],
        dirtyNotTouched: [],
      },
    })
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
    expect(screen.getByText(/工作目录不是 Git 仓库/)).toBeDefined()
    expect(screen.getByTestId('diff-ai-attributed-section')).toBeDefined()
  })

  it('shows no-changes when neither AI nor git have rows', () => {
    useChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        files: [],
        additions: 0,
        deletions: 0,
      },
    })
    useAiChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        timedOut: false,
        onDisk: [],
        reverted: [],
        dirtyNotTouched: [],
      },
    })
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
    expect(screen.getByText('diff.noChanges')).toBeDefined()
  })
})
