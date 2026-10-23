import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewListPanel } from '@/components/issue-detail/ReviewListPanel'
import i18n from '@/i18n'

/** The review queue's list matches the project issue list: same header, group bars and rows (with menus). */

const issue = (id: string, n: number, projectId: string, projectName: string) => ({
  id,
  issueNumber: n,
  title: `Issue ${n}`,
  projectId,
  projectName,
  projectAlias: projectName,
  statusId: 'review',
  isPinned: false,
})

vi.mock('@/hooks/use-kanban', () => ({
  useReviewIssues: () => ({
    data: [issue('a', 1, 'p1', 'blog'), issue('b', 2, 'p1', 'blog'), issue('c', 4, 'p2', 'test')],
    isLoading: false,
  }),
  useUpdateIssue: () => ({ mutate: vi.fn() }),
  useDeleteIssue: () => ({ mutate: vi.fn() }),
  useDuplicateIssue: () => ({ mutate: vi.fn() }),
}))

function renderPanel() {
  return render(
    <MemoryRouter>
      <ReviewListPanel activeIssueId="" />
    </MemoryRouter>,
  )
}

describe('review list panel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('has a header as tall as the project list header, so the rows line up', () => {
    renderPanel()
    expect(screen.getByText('Review').closest('[data-slot="list-header"]')).toHaveClass('min-h-[49px]')
  })

  it('groups by project with collapsible bars showing the count in parentheses', () => {
    renderPanel()
    const blog = screen.getByRole('button', { name: /blog/ })
    expect(blog).toHaveAttribute('aria-expanded', 'true')
    expect(within(blog).getByText(/\(\s*2\s*\)/)).toBeInTheDocument()
    fireEvent.click(blog)
    expect(blog).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Issue 1')).toBeNull()
    expect(screen.getByText('Issue 4')).toBeInTheDocument()
  })

  it('offers the issue menu on right-click and from the "..." button', async () => {
    renderPanel()
    fireEvent.contextMenu(screen.getByText('Issue 1'))
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    const row = screen.getByText('Issue 4').closest('[role="button"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button'))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })
})
