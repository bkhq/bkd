import type { Issue } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KanbanCard } from '@/components/kanban/KanbanCard'
import { KanbanColumn } from '@/components/kanban/KanbanColumn'
import i18n from '@/i18n'
import { STATUS_MAP } from '@/lib/statuses'

vi.mock('@/hooks/use-kanban', () => ({
  useUpdateIssue: () => ({ mutate: vi.fn() }),
  useDeleteIssue: () => ({ mutate: vi.fn() }),
  useDuplicateIssue: () => ({ mutate: vi.fn() }),
}))

describe('kanban column header', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the count in parentheses and "+" only for Todo and Working', () => {
    const { unmount } = render(<KanbanColumn status={STATUS_MAP.get('working')!} issues={[]} projectId="p1" />)
    expect(screen.getByText(/\(\s*0\s*\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create issue in Working' })).toBeInTheDocument()
    unmount()
    for (const id of ['review', 'done']) {
      const { unmount: un } = render(<KanbanColumn status={STATUS_MAP.get(id)!} issues={[]} projectId="p1" />)
      expect(screen.queryByRole('button', { name: /Create issue in/ })).toBeNull()
      un()
    }
  })
})

describe('kanban card', () => {
  it('opens the issue on click and the issue menu on right-click', async () => {
    const issue = { id: 'i1', issueNumber: 7, title: 'Fix it', statusId: 'todo', isPinned: false, tags: ['ui'] } as unknown as Issue
    const onCardClick = vi.fn()
    render(<KanbanCard issue={issue} projectId="p1" onCardClick={onCardClick} />)
    expect(screen.getByText('ui')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Fix it'))
    expect(onCardClick).toHaveBeenCalledWith(issue)
    fireEvent.contextMenu(screen.getByText('Fix it'))
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
  })
})
