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
  useIssueAiTimeline: () => ({
    data: {
      path: 'a.ts',
      baselineSource: 'edit',
      baseline: 'foo',
      finalBuffer: 'bar',
      netAdditions: 0,
      netDeletions: 0,
      status: 'clean',
      edits: [{
        turnIndex: 0,
        entryIndex: 1,
        at: '2026-05-19T00:00:00.000Z',
        toolName: 'Edit',
        bufferLinesAfter: 1,
        additions: 0,
        deletions: 0,
        skipped: false,
        summary: 'Edit: 1 hunk',
      }],
    },
    isLoading: false,
    isError: false,
  }),
  useIssueFilePatch: () => ({ data: undefined, isLoading: false, isError: false }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('diffPanel AI-attributed section', () => {
  beforeEach(() => {
    useChangesMock.mockReset()
    useAiChangesMock.mockReset()
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

  it('renders rows from onDisk + reverted with status badges', () => {
    useAiChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        timedOut: false,
        onDisk: [
          {
            path: 'src/a.ts',
            rawPath: '/tmp/p/src/a.ts',
            toolName: 'Edit',
            editCount: 3,
            firstTurnIndex: 0,
            lastTurnIndex: 2,
            lastTouchAt: '2026-05-19T00:00:00.000Z',
            status: 'edited',
          },
          {
            path: 'src/new.ts',
            rawPath: '/tmp/p/src/new.ts',
            toolName: 'Write',
            editCount: 1,
            firstTurnIndex: 1,
            lastTurnIndex: 1,
            lastTouchAt: '2026-05-19T00:01:00.000Z',
            status: 'created',
          },
        ],
        reverted: [
          {
            path: 'src/oops.ts',
            rawPath: '/tmp/p/src/oops.ts',
            toolName: 'Edit',
            editCount: 2,
            firstTurnIndex: 0,
            lastTurnIndex: 1,
            lastTouchAt: '2026-05-19T00:02:00.000Z',
            status: 'edited',
          },
        ],
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
    const section = screen.getByTestId('diff-ai-attributed-section')
    expect(section).toBeDefined()
    expect(section.textContent).toContain('src/a.ts')
    expect(section.textContent).toContain('src/new.ts')
    expect(section.textContent).toContain('src/oops.ts')
    expect(section.textContent).toContain('NEW')
    expect(section.textContent).toContain('REVERTED')
    expect(section.textContent).toContain('×3')
    expect(section.textContent).toContain('turn 0–2')
  })

  it('hides section when there are no AI-touched files', () => {
    useAiChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        timedOut: false,
        onDisk: [],
        reverted: [],
        dirtyNotTouched: ['lockfile.lock'],
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
    expect(screen.queryByTestId('diff-ai-attributed-section')).toBeNull()
  })

  it('expands per-file timeline on row click and shows per-turn edits', () => {
    useAiChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        timedOut: false,
        onDisk: [
          {
            path: 'a.ts',
            rawPath: 'a.ts',
            toolName: 'Edit',
            editCount: 1,
            firstTurnIndex: 0,
            lastTurnIndex: 0,
            lastTouchAt: '2026-05-19T00:00:00.000Z',
            status: 'edited',
          },
        ],
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
    expect(screen.queryByTestId('ai-file-timeline-a.ts')).toBeNull()
    fireEvent.click(screen.getByTestId('ai-file-row-a.ts'))
    expect(screen.getByTestId('ai-file-timeline-a.ts')).toBeDefined()
    expect(screen.getByTestId('ai-file-timeline-a.ts').textContent).toContain('Edit: 1 hunk')
  })

  it('toggles expansion on header click', () => {
    useAiChangesMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        root: '/tmp/p',
        gitRepo: true,
        timedOut: false,
        onDisk: [
          {
            path: 'a.ts',
            rawPath: 'a.ts',
            toolName: 'Edit',
            editCount: 1,
            firstTurnIndex: 0,
            lastTurnIndex: 0,
            lastTouchAt: '2026-05-19T00:00:00.000Z',
            status: 'edited',
          },
        ],
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
    const section = screen.getByTestId('diff-ai-attributed-section')
    // Expanded by default — file row visible
    expect(section.textContent).toContain('a.ts')
    // Click header to collapse
    const header = section.querySelector('button')!
    fireEvent.click(header)
    expect(section.querySelector('ul')).toBeNull()
  })
})
