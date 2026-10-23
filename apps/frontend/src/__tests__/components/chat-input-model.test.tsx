import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from '@/components/issue-detail/ChatInput'

const updateMutate = vi.fn()

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/use-changes-summary', () => ({ useChangesSummary: () => null }))
vi.mock('@/hooks/use-kanban', () => ({
  useFollowUpIssue: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearIssueSession: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssue: () => ({ mutate: updateMutate }),
  useEngineAvailability: () => ({
    data: {
      models: {
        'claude-code': [
          { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' },
          { id: 'claude-opus-5-5', name: 'claude-opus-5-5' },
        ],
      },
    },
  }),
  useEngineSettings: () => ({ data: undefined }),
  useEngineProfiles: () => ({ data: [] }),
}))

afterEach(() => {
  cleanup()
  updateMutate.mockClear()
})

async function pickModel(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /sonnet/i }))
  fireEvent.click(await screen.findByRole('menuitem', { name }))
}

function renderInput(statusId: string, sessionStatus: 'completed' | null = null) {
  render(
    <ChatInput
      projectId="p1"
      issueId="i1"
      engineType="claude-code"
      model="claude-sonnet-5-5"
      statusId={statusId}
      sessionStatus={sessionStatus}
    />,
  )
}

describe('chatInput model selector', () => {
  it.each(['todo', 'review', 'done'])('saves the model right away on a %s issue', async (statusId) => {
    renderInput(statusId, statusId === 'todo' ? null : 'completed')
    await pickModel(/opus/i)
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(updateMutate.mock.calls[0][0]).toEqual({ id: 'i1', model: 'claude-opus-5-5' })
  })

  it('leaves a working issue to send the model with the next message', async () => {
    renderInput('working', 'completed')
    await pickModel(/opus/i)
    expect(updateMutate).not.toHaveBeenCalled()
  })
})
