import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatInput } from '@/components/issue-detail/ChatInput'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> | string) =>
      typeof opts === 'string' ? opts : key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/components/EngineIcons', () => ({
  EngineIcon: ({ engineType }: { engineType?: string }) => (
    <span data-testid={`engine-icon-${engineType ?? 'none'}`} />
  ),
}))

vi.mock('@/hooks/use-kanban', () => ({
  useRoles: () => ({ data: [], isLoading: false }),
  useCreateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFollowUpIssue: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearIssueSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRestartIssue: () => ({ mutate: vi.fn(), isPending: false }),
  useEngineAvailability: () => ({
    data: {
      models: {
        'claude-code': [
          { id: 'sonnet-4-5', name: 'Sonnet 4.5', isDefault: true },
        ],
      },
    },
  }),
  useEngineSettings: () => ({ data: { engines: {} } }),
  useOmitModel: () => ({ data: { enabled: false } }),
}))

vi.mock('@/hooks/use-changes-summary', () => ({
  useChangesSummary: () => ({ fileCount: 0, additions: 0, deletions: 0, root: 'main' }),
}))

vi.mock('@/stores/file-browser-store', () => ({
  useFileBrowserStore: (selector: (s: { isOpen: boolean, openForIssue: () => void }) => unknown) =>
    selector({ isOpen: false, openForIssue: vi.fn() }),
}))

// Force mobile mode for this entire test file
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => true,
}))

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
})

function renderChat(props?: Partial<React.ComponentProps<typeof ChatInput>>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const merged = { projectId: 'p1', issueId: 'i1', engineType: 'claude-code', model: '', sessionStatus: null as never, statusId: 'working', slashCommands: [] as string[], ...props }
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ChatInput {...merged} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('chatInput — mobile collapsed mode regression', () => {
  // Regression: mobileCollapsed required `!isSessionActive`, so sending a
  // message (which flips sessionStatus to 'running') immediately expanded
  // the full toolbar. Fix removes that condition and swaps the right-hand
  // button instead (cancel / send / focus) while keeping the toolbar hidden.

  it('keeps the toolbar hidden on mobile after sending (isSessionActive=true)', () => {
    renderChat({ sessionStatus: 'running' })
    // Collapsed action bar visible, full toolbar hidden
    expect(screen.getByTestId('mobile-collapsed-actions')).toBeInTheDocument()
    expect(screen.getByTestId('chat-toolbar')).toHaveClass('hidden')
  })

  it('shows the cancel button in collapsed mode while thinking on mobile', () => {
    const onCancel = vi.fn()
    renderChat({ isThinking: true, onCancel })
    const actions = screen.getByTestId('mobile-collapsed-actions')
    expect(actions).toBeInTheDocument()
    const buttons = actions.querySelectorAll('button')
    expect(buttons.length).toBe(2)
    expect(buttons[1].getAttribute('title')).toBe('common.cancel')
    expect(screen.getByTestId('chat-toolbar')).toHaveClass('hidden')
  })

  it('shows the send button in collapsed mode while session is active (not thinking)', () => {
    renderChat({ sessionStatus: 'running' as never })
    const actions = screen.getByTestId('mobile-collapsed-actions')
    expect(actions).toBeInTheDocument()
    const buttons = actions.querySelectorAll('button')
    expect(buttons.length).toBe(2) // MobileMoreMenu + send
    expect(buttons[1].getAttribute('title')).toBe('chat.send')
    expect(screen.getByTestId('chat-toolbar')).toHaveClass('hidden')
  })

  it('shows the focus button in collapsed mode when idle on mobile', () => {
    renderChat({ sessionStatus: null })
    const actions = screen.getByTestId('mobile-collapsed-actions')
    expect(actions).toBeInTheDocument()
    const buttons = actions.querySelectorAll('button')
    expect(buttons.length).toBe(2) // MobileMoreMenu + focus
    expect(buttons[1].getAttribute('title')).toBe('chat.placeholder')
    expect(screen.getByTestId('chat-toolbar')).toHaveClass('hidden')
  })
})
