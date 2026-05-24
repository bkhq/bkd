import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ForkDialog } from '@/components/issue-detail/ForkDialog'

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
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useForkIssue: () => ({ mutate: mutateMock, isPending: false }),
}))

describe('forkDialog', () => {
  beforeEach(() => {
    mutateMock.mockReset()
    navigateMock.mockReset()
  })

  it('disables submit until an instruction is entered', () => {
    render(<ForkDialog open issueId="iss1" projectId="p1" onOpenChange={() => {}} />)
    const submit = screen.getByText('chat.fork.dialog.createAndRun')
    expect((submit as HTMLButtonElement).disabled).toBe(true)
  })

  it('forks now with the entered instruction', () => {
    render(<ForkDialog open issueId="iss1" projectId="p1" onOpenChange={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('chat.fork.dialog.instruction'), {
      target: { value: 'Write tests' },
    })
    fireEvent.click(screen.getByText('chat.fork.dialog.createAndRun'))
    expect(mutateMock).toHaveBeenCalledTimes(1)
    expect(mutateMock.mock.calls[0][0]).toEqual({
      issueId: 'iss1',
      data: {
        instruction: 'Write tests',
        runWhen: 'now',
        fromLogId: undefined,
        inheritEngine: true,
      },
    })
  })

  it('switches to after-parent and shows the schedule button', () => {
    render(<ForkDialog open issueId="iss1" projectId="p1" onOpenChange={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('chat.fork.dialog.instruction'), {
      target: { value: 'Run later' },
    })
    fireEvent.click(screen.getByText('chat.fork.dialog.runWhen.after-parent'))
    fireEvent.click(screen.getByText('chat.fork.dialog.schedule'))
    expect(mutateMock.mock.calls[0][0].data.runWhen).toBe('after-parent')
  })

  it('passes fromLogId through when forking from a message', () => {
    render(
      <ForkDialog open issueId="iss1" projectId="p1" fromLogId="log9" onOpenChange={() => {}} />,
    )
    fireEvent.change(screen.getByPlaceholderText('chat.fork.dialog.instruction'), {
      target: { value: 'From message' },
    })
    fireEvent.click(screen.getByText('chat.fork.dialog.createAndRun'))
    expect(mutateMock.mock.calls[0][0].data.fromLogId).toBe('log9')
  })
})
