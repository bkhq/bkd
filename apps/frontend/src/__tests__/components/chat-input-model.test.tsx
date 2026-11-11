import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatInput } from '@/components/issue-detail/ChatInput'
import { useFileBrowserStore } from '@/stores/file-browser-store'

const updateMutate = vi.fn()
const followUpMutate = vi.fn().mockResolvedValue({})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/use-changes-summary', () => ({ useChangesSummary: () => null }))
vi.mock('@/hooks/use-kanban', () => ({
  useFollowUpIssue: () => ({ mutateAsync: followUpMutate, isPending: false }),
  useClearIssueSession: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssue: () => ({ mutate: updateMutate }),
  useEngineAvailability: () => ({
    data: {
      models: {
        'claude-code': [
          { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' },
          { id: 'claude-opus-5-5', name: 'claude-opus-5-5' },
        ],
        'fable-high': [{ id: 'claude-fable-5-2', name: 'claude-fable-5-2' }],
        'codex-alt': [{ id: 'gpt-alt', name: 'gpt-alt' }],
      },
    },
  }),
  useEngineSettings: () => ({ data: undefined }),
  useEngineProfiles: () => ({ data: [] }),
  useVirtualEngines: () => ({
    data: [
      { id: 'fable-high', name: 'Fable high', baseEngine: 'claude-code', envVars: {} },
      { id: 'codex-alt', name: 'Codex alt', baseEngine: 'codex', envVars: {} },
    ],
  }),
}))

afterEach(() => {
  cleanup()
  updateMutate.mockClear()
  followUpMutate.mockClear()
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
      baseEngine="claude-code"
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

describe('chatInput engine switch', () => {
  it('lists the models of engines sharing the base engine only', async () => {
    renderInput('review', 'completed')
    fireEvent.click(screen.getByRole('button', { name: /sonnet/i }))
    expect(await screen.findByRole('menuitem', { name: /fable/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /gpt-alt/i })).toBeNull()
  })

  it('saves the engine with the model outside working', async () => {
    renderInput('review', 'completed')
    await pickModel(/fable/i)
    expect(updateMutate.mock.calls[0][0]).toEqual({ id: 'i1', model: 'claude-fable-5-2', engineType: 'fable-high' })
  })

  it('sends the engine and effort with the next message while working', async () => {
    renderInput('working', 'completed')
    await pickModel(/fable/i)
    fireEvent.click(screen.getByRole('button', { name: 'chat.effortLevel.auto' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'chat.effortLevel.high' }))
    expect(updateMutate).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'go' } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.send' }))
    await vi.waitFor(() => expect(followUpMutate).toHaveBeenCalledTimes(1))
    expect(followUpMutate.mock.calls[0][0]).toMatchObject({
      model: 'claude-fable-5-2',
      engineType: 'fable-high',
      effort: 'high',
    })
  })
})

describe('chatInput effort selector', () => {
  it('saves the effort right away outside working', async () => {
    renderInput('review', 'completed')
    fireEvent.click(screen.getByRole('button', { name: 'chat.effortLevel.auto' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'chat.effortLevel.max' }))
    expect(updateMutate.mock.calls[0][0]).toEqual({ id: 'i1', effort: 'max' })
  })
})

describe('chatInput pending edit', () => {
  it('restores the text and attachments of a recalled message', () => {
    const onConsumed = vi.fn()
    render(
      <ChatInput
        projectId="p1"
        issueId="i1"
        engineType="claude-code"
        pendingEdit={{ content: 'edit me', files: [new File(['png'], 'image.png', { type: 'image/png' })] }}
        onPendingEditConsumed={onConsumed}
      />,
    )
    expect(screen.getByRole('textbox')).toHaveValue('edit me')
    expect(screen.getByText('image.png')).toBeInTheDocument()
    expect(onConsumed).toHaveBeenCalledTimes(1)
  })
})

describe('chatInput files button', () => {
  it('opens the file browser drawer on the issue', () => {
    useFileBrowserStore.setState({ isOpen: false, projectId: null, issueId: null })
    renderInput('review', 'completed')
    fireEvent.click(screen.getByTitle('diff.openFiles'))
    expect(useFileBrowserStore.getState()).toMatchObject({ isOpen: true, projectId: 'p1', issueId: 'i1' })
  })
})
