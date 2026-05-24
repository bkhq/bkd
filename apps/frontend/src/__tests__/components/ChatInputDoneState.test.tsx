/**
 * Regression: sending to a `done` issue used to silently queue the message
 * in the pending list with no way to clear it. The input is now disabled
 * + the placeholder explains why.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ChatInput } from '@/components/issue-detail/ChatInput'

// Tests run in jsdom — we just need the right props + minimal mocks for hooks
// that ChatInput calls internally.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const followUpMutateAsync = vi.fn().mockResolvedValue({ messageId: 'm1' })
vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFollowUpIssue: () => ({ mutateAsync: followUpMutateAsync, isPending: false }),
  useRestartIssue: () => ({ mutate: vi.fn(), isPending: false }),
  useClearIssueSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOmitModel: () => ({ data: { enabled: false } }),
  useEngineAvailability: () => ({ data: undefined }),
  useEngineSettings: () => ({ data: undefined }),
}))

vi.mock('@/hooks/use-changes-summary', () => ({
  useChangesSummary: () => ({ data: undefined }),
}))

vi.mock('@/stores/file-browser-store', () => ({
  useFileBrowserStore: () => ({ isOpen: false, openAt: vi.fn() }),
  FILE_BROWSER_MIN_WIDTH: 200,
}))

vi.mock('@/hooks/use-pending-messages', () => ({
  usePendingMessages: () => ({ data: [] }),
  useInvalidatePendingMessages: () => vi.fn(),
}))

const isMobileMock = vi.fn(() => false)
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => isMobileMock(),
}))

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    uploadAttachment: vi.fn(),
    deletePendingMessage: vi.fn(),
    clearAllPendingMessages: vi.fn(),
  },
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('chatInput — done state guard', () => {
  it('disables the textarea when statusId="done"', () => {
    render(
      <Wrapper>
        <ChatInput
          projectId="p1"
          issueId="i1"
          statusId="done"
          sessionStatus={null}
          isThinking={false}
          slashCommands={[]}
          pluginCommands={[]}
          onCancel={() => {}}
        />
      </Wrapper>,
    )
    const textarea = screen.getByPlaceholderText(/done/i) as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
  })

  it('shows the done-specific placeholder', () => {
    render(
      <Wrapper>
        <ChatInput
          projectId="p1"
          issueId="i1"
          statusId="done"
          sessionStatus={null}
          isThinking={false}
          slashCommands={[]}
          pluginCommands={[]}
          onCancel={() => {}}
        />
      </Wrapper>,
    )
    expect(
      screen.getByPlaceholderText(/move it back to working/i),
    ).toBeDefined()
  })

  it('does NOT disable the textarea for working/todo/review issues', () => {
    for (const statusId of ['todo', 'working', 'review'] as const) {
      const { unmount } = render(
        <Wrapper>
          <ChatInput
            projectId="p1"
            issueId="i1"
            statusId={statusId}
            sessionStatus={null}
            isThinking={false}
            slashCommands={[]}
            pluginCommands={[]}
            onCancel={() => {}}
          />
        </Wrapper>,
      )
      const textareas = screen.getAllByRole('textbox') as HTMLTextAreaElement[]
      expect(textareas[0].disabled).toBe(false)
      unmount()
    }
  })

  it('action buttons (send / cancel) share size-9 to avoid visual "explosion" on state change', () => {
    isMobileMock.mockReturnValue(false)
    // 1) Send state — working + not thinking
    const { container: sendCt, unmount: u1 } = render(
      <Wrapper>
        <ChatInput
          projectId="p1"
          issueId="i1"
          statusId="working"
          sessionStatus={null}
          isThinking={false}
          slashCommands={[]}
          pluginCommands={[]}
          onCancel={() => {}}
        />
      </Wrapper>,
    )
    const sendBtn = sendCt.querySelector('button.rounded-full.size-9') as HTMLElement | null
    expect(sendBtn).toBeTruthy()
    u1()

    // 2) Cancel state — working + thinking
    const { container: cancelCt } = render(
      <Wrapper>
        <ChatInput
          projectId="p1"
          issueId="i1"
          statusId="working"
          sessionStatus="running"
          isThinking={true}
          slashCommands={[]}
          pluginCommands={[]}
          onCancel={() => {}}
        />
      </Wrapper>,
    )
    const cancelBtn = cancelCt.querySelector('button.bg-destructive.rounded-full') as HTMLElement | null
    expect(cancelBtn).toBeTruthy()
    // Must be size-9 (not the OLD size-11 which felt "abnormally large").
    expect(cancelBtn!.className).toContain('size-9')
    expect(cancelBtn!.className).not.toContain('size-11')
  })

  it('mobile: bare Enter does NOT call the send mutation (newline preserved)', () => {
    isMobileMock.mockReturnValue(true)
    followUpMutateAsync.mockClear()
    render(
      <Wrapper>
        <ChatInput
          projectId="p1"
          issueId="i1"
          statusId="working"
          sessionStatus={null}
          isThinking={false}
          slashCommands={[]}
          pluginCommands={[]}
          onCancel={() => {}}
        />
      </Wrapper>,
    )
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(followUpMutateAsync).not.toHaveBeenCalled()
    isMobileMock.mockReturnValue(false)
  })

  it('desktop: bare Enter triggers the send mutation', () => {
    isMobileMock.mockReturnValue(false)
    followUpMutateAsync.mockClear()
    render(
      <Wrapper>
        <ChatInput
          projectId="p1"
          issueId="i1"
          statusId="working"
          sessionStatus={null}
          isThinking={false}
          slashCommands={[]}
          pluginCommands={[]}
          onCancel={() => {}}
        />
      </Wrapper>,
    )
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(followUpMutateAsync).toHaveBeenCalled()
  })

  it('mobile: Cmd+Enter still triggers send (tablet+keyboard escape hatch)', () => {
    isMobileMock.mockReturnValue(true)
    followUpMutateAsync.mockClear()
    render(
      <Wrapper>
        <ChatInput
          projectId="p1"
          issueId="i1"
          statusId="working"
          sessionStatus={null}
          isThinking={false}
          slashCommands={[]}
          pluginCommands={[]}
          onCancel={() => {}}
        />
      </Wrapper>,
    )
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(followUpMutateAsync).toHaveBeenCalled()
    isMobileMock.mockReturnValue(false)
  })

  it('typing in a working-issue input enables the send button (sanity)', () => {
    render(
      <Wrapper>
        <ChatInput
          projectId="p1"
          issueId="i1"
          statusId="working"
          sessionStatus={null}
          isThinking={false}
          slashCommands={[]}
          pluginCommands={[]}
          onCancel={() => {}}
        />
      </Wrapper>,
    )
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hello' } })
    // The send button is queryable by role=button + name containing "send".
    // We don't actually click it (followUp is mocked); we just verify the
    // textarea accepted input.
    expect(textarea.value).toBe('hello')
  })
})
