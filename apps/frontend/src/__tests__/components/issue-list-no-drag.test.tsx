import type { Issue } from '@bkd/shared'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

/** The list panel follows the API order and takes no drags, so scrolling never moves an issue. */

const drag = vi.hoisted(() => ({ provider: vi.fn(), group: vi.fn(), sortable: vi.fn() }))

vi.mock('@/components/issue-drag/IssueDragContext', () => ({
  IssueDragProvider: ({ children }: { children: unknown }) => {
    drag.provider()
    return children
  },
  useIssueDropGroup: () => {
    drag.group()
    return { setNodeRef: () => {}, isTarget: false, slot: null }
  },
  SortableIssues: ({ items, children }: { items: Issue[], children: (issue: Issue) => unknown }) => {
    drag.sortable()
    return items.map(children)
  },
}))

vi.mock('@/hooks/use-kanban', () => ({
  useUpdateIssue: () => ({ mutate: vi.fn() }),
  useDeleteIssue: () => ({ mutate: vi.fn() }),
  useDuplicateIssue: () => ({ mutate: vi.fn() }),
}))

describe('issue list drag', () => {
  it('renders the rows of a group without any drag or drop wiring', async () => {
    const { StatusGroup } = await import('@/components/issue-detail/IssueListPanel')
    const { STATUS_MAP } = await import('@/lib/statuses')
    const issue = { id: 'i1', issueNumber: 1, title: 'Fix it', isPinned: false, statusId: 'todo', tags: [] } as unknown as Issue
    render(
      <MemoryRouter>
        <StatusGroup
          status={STATUS_MAP.get('todo')!}
          issues={[issue]}
          projectId="p1"
          isCollapsed={false}
          onToggle={() => {}}
          activeIssueId=""
          onNavigate={() => {}}
          onActiveDeleted={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Fix it')).toBeInTheDocument()
    expect(drag.group).not.toHaveBeenCalled()
    expect(drag.sortable).not.toHaveBeenCalled()
  })
})
