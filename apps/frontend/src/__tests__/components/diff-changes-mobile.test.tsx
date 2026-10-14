import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { DiffChanges } from '@/components/issue-detail/DiffPanel'
import { useDiffViewStore } from '@/stores/diff-view-store'

const mocks = vi.hoisted(() => ({ isMobile: true, worktreeMissing: false }))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.isMobile }))
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ resolved: 'light' }) }))
vi.mock('@/hooks/use-kanban', () => ({
  useIssueChanges: () => ({
    isLoading: false,
    isError: false,
    data: {
      gitRepo: true,
      root: '/ws',
      worktreeMissing: mocks.worktreeMissing,
      additions: 3,
      deletions: 1,
      files: [
        { path: 'src/a.ts', status: 'M', type: 'modified', staged: false, unstaged: true, additions: 2, deletions: 1 },
        { path: 'b.md', status: '??', type: 'untracked', staged: false, unstaged: true, additions: 1, deletions: 0 },
      ],
    },
  }),
  useIssueFilePatch: () => ({ isLoading: false, isError: false, data: undefined }),
}))
// The virtualizer and worker pool are browser-only; render children directly.
vi.mock('@pierre/diffs/react', () => ({
  Virtualizer: ({ children, className }: { children: ReactNode, className?: string }) => <div className={className}>{children}</div>,
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  MultiFileDiff: () => null,
  PatchDiff: () => null,
}))
vi.mock('@pierre/diffs/worker/worker.js?worker', () => ({ default: class {} }))

function renderChanges() {
  return render(<DiffChanges projectId="p1" issueId="i1" toolbar />)
}

describe('review tab on a phone', () => {
  beforeEach(async () => {
    mocks.isMobile = true
    mocks.worktreeMissing = false
    localStorage.clear()
    useDiffViewStore.setState({ showTree: false, diffStyle: 'split' })
    globalThis.IntersectionObserver ??= class {
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver
    await i18n.changeLanguage('en')
  })

  it('opens the tree over the list, and picking a file closes it again', () => {
    renderChanges()
    const list = screen.getByText('src/a.ts')
    expect(list).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'File tree' }))
    expect(screen.getByPlaceholderText('Filter files…')).toBeInTheDocument()
    expect(list).not.toBeVisible()

    // The row's name ends with its status letter
    fireEvent.click(screen.getByRole('button', { name: /^a\.ts/ }))
    expect(screen.queryByPlaceholderText('Filter files…')).not.toBeInTheDocument()
    expect(list).toBeVisible()
    // The phone toggle never touches the persisted desktop preference
    expect(useDiffViewStore.getState().showTree).toBe(false)
  })

  it('offers no split view', () => {
    renderChanges()
    fireEvent.click(screen.getByRole('button', { name: 'View options' }))
    expect(screen.queryByText('Split')).not.toBeInTheDocument()
    expect(screen.getByText('Wrap lines')).toBeInTheDocument()
  })
})

describe('review tab with a missing worktree', () => {
  beforeEach(async () => {
    mocks.isMobile = false
    mocks.worktreeMissing = true
    await i18n.changeLanguage('en')
  })

  it('explains instead of listing changes', () => {
    renderChanges()
    expect(screen.queryByText('src/a.ts')).not.toBeInTheDocument()
    expect(screen.getByText(/worktree no longer exists/)).toBeInTheDocument()
  })
})
