import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GanttChart from '@/components/workspace/GanttChart'

const mockIssues = [
  {
    id: 'issue-1',
    title: 'Root Task',
    statusId: 'working',
    sessionStatus: 'working',
    issueNumber: 1,
    children: [
      {
        id: 'issue-2',
        title: 'Child Task',
        statusId: 'todo',
        sessionStatus: null,
        issueNumber: 2,
        children: [],
      },
    ],
  },
  {
    id: 'issue-3',
    title: 'Done Task',
    statusId: 'done',
    sessionStatus: 'done',
    issueNumber: 3,
    children: [],
  },
]

describe('ganttChart', () => {
  it('renders all issues', () => {
    render(<GanttChart issues={mockIssues} onIssueClick={() => {}} />)
    // Text content includes @id prefix, e.g. "@issue-1 Root Task"
    expect(screen.getByText(/Root Task/)).toBeDefined()
    expect(screen.getByText(/Child Task/)).toBeDefined()
    expect(screen.getByText(/Done Task/)).toBeDefined()
  })

  it('renders root issues count heading', () => {
    render(<GanttChart issues={mockIssues} onIssueClick={() => {}} />)
    expect(screen.getByText(/2 root issues/)).toBeDefined()
  })

  it('calls onIssueClick when clicking an issue row', () => {
    const onClick = vi.fn()
    render(<GanttChart issues={mockIssues} onIssueClick={onClick} />)
    fireEvent.click(screen.getByText(/Root Task/))
    expect(onClick).toHaveBeenCalledWith('issue-1')
  })

  it('renders status and progress for each issue', () => {
    render(<GanttChart issues={mockIssues} onIssueClick={() => {}} />)
    expect(screen.getByText('working')).toBeDefined()
    expect(screen.getByText('todo')).toBeDefined()
    expect(screen.getByText('done')).toBeDefined()
    expect(screen.getByText('40%')).toBeDefined()
    expect(screen.getByText('0%')).toBeDefined()
    expect(screen.getByText('100%')).toBeDefined()
  })

  it('renders nothing extra when issues is empty', () => {
    render(<GanttChart issues={[]} onIssueClick={() => {}} />)
    expect(screen.getByText(/0 root issues/)).toBeDefined()
  })
})
