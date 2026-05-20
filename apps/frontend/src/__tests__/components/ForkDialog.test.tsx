import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ForkDialog } from '@/components/issue-detail/ForkDialog'
import type { Issue } from '@/types/kanban'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const mutateMock = vi.fn()
vi.mock('@/hooks/use-kanban', () => ({
  useForkIssue: () => ({ mutate: mutateMock, isPending: false }),
}))

const issue = { id: 'iss1', issueNumber: 7, title: 'Parent' } as Issue

describe('forkDialog', () => {
  beforeEach(() => {
    mutateMock.mockReset()
    navigateMock.mockReset()
  })

  it('disables submit until an instruction is entered', () => {
    render(<ForkDialog open issue={issue} projectId="p1" onOpenChange={() => {}} />)
    const createAndRun = screen.getByText('chat.fork.dialog.createAndRun')
    expect((createAndRun as HTMLButtonElement).disabled).toBe(true)
  })

  it('forks with the chosen mode and autoExecute on Create and run', () => {
    render(<ForkDialog open issue={issue} projectId="p1" onOpenChange={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('chat.fork.dialog.instruction'), {
      target: { value: 'Write tests' },
    })
    fireEvent.click(screen.getByText('chat.fork.dialog.createAndRun'))
    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({
      issueId: 'iss1',
      data: {
        instruction: 'Write tests',
        mode: 'independent',
        includeHistory: false,
        inheritEngine: true,
        autoExecute: true,
      },
    })
  })

  it('switches to dependent mode and shows the schedule button', () => {
    render(<ForkDialog open issue={issue} projectId="p1" onOpenChange={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('chat.fork.dialog.instruction'), {
      target: { value: 'Run later' },
    })
    fireEvent.click(screen.getByText('chat.fork.dialog.mode.dependent'))
    fireEvent.click(screen.getByText('chat.fork.dialog.schedule'))
    expect(mutateMock.mock.calls[0][0].data.mode).toBe('dependent')
    expect(mutateMock.mock.calls[0][0].data.autoExecute).toBe(false)
  })
})
