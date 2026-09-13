import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateIssueForm } from '@/components/kanban/CreateIssueDialog'

const mutate = vi.fn()

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/use-kanban', () => ({
  useCreateIssue: () => ({ mutate, isPending: false }),
  useProject: () => ({ data: { id: 'p1', isGitRepo: true } }),
  useEngineAvailability: () => ({ data: undefined }),
  useEngineProfiles: () => ({ data: [] }),
  useEngineSettings: () => ({ data: undefined }),
}))

afterEach(() => {
  cleanup()
  mutate.mockClear()
})

/** The status row is the first switch in the property grid; the worktree row follows it. */
function statusSwitch() {
  return screen.getAllByRole('switch')[0]
}

function submit(title: string) {
  fireEvent.change(screen.getByPlaceholderText('issue.describeWork'), { target: { value: title } })
  fireEvent.click(screen.getByText('createIssue.create'))
}

describe('createIssueForm status toggle', () => {
  it('defaults to todo and creates a queued issue', () => {
    render(<CreateIssueForm projectId="p1" />)

    expect(statusSwitch()).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('statusName.Todo')).toBeInTheDocument()

    submit('queued work')
    expect(mutate.mock.calls[0][0]).toMatchObject({ title: 'queued work', statusId: 'todo' })
  })

  it('switches to working and creates an executing issue', () => {
    render(<CreateIssueForm projectId="p1" />)

    fireEvent.click(statusSwitch())
    expect(screen.getByText('statusName.Working')).toBeInTheDocument()

    submit('start now')
    expect(mutate.mock.calls[0][0]).toMatchObject({ statusId: 'working' })
  })

  it('folds an executing column status onto working', () => {
    render(<CreateIssueForm projectId="p1" initialStatusId="review" />)

    expect(statusSwitch()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('statusName.Working')).toBeInTheDocument()
  })

  it('folds a non-executing column status onto todo', () => {
    render(<CreateIssueForm projectId="p1" initialStatusId="done" />)

    expect(statusSwitch()).toHaveAttribute('aria-checked', 'false')
  })
})
