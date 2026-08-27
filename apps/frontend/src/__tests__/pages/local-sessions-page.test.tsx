import type { LocalSession, NormalizedLogEntry } from '@bkd/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import LocalSessionsPage from '@/pages/LocalSessionsPage'

/** Local session listing, detail view and import dialog (SES-001, SES-002). */

const mocks = vi.hoisted(() => ({
  importMutate: vi.fn(),
  deleteMutate: vi.fn(),
  listSessions: vi.fn(),
  readSession: vi.fn(),
}))

const matched: LocalSession = {
  engine: 'claude-code',
  sessionId: 'session-matched',
  cwd: '/app/demo',
  title: 'ship the login page',
  lastActiveAt: '2026-08-20T00:00:00.000Z',
  sizeBytes: 2048,
  model: 'claude-opus-5',
  cliVersion: '2.1.231',
  matchedProjectId: 'p1',
}

const mismatched: LocalSession = {
  engine: 'codex',
  sessionId: 'session-elsewhere',
  cwd: '/somewhere/else',
  title: 'unrelated work',
  lastActiveAt: '2026-08-19T00:00:00.000Z',
  sizeBytes: 1024,
}

const entries: NormalizedLogEntry[] = [
  { entryType: 'user-message', content: 'ship the login page', messageId: 'e1' },
  { entryType: 'assistant-message', content: 'on it', messageId: 'e2' },
]

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ resolved: 'light' }),
}))

vi.mock('@/hooks/use-kanban', () => ({
  useLocalSessions: (filters: unknown) => {
    mocks.listSessions(filters)
    return { data: { sessions: [matched, mismatched], total: 2, hasMore: false }, isLoading: false }
  },
  useLocalSession: (engine: string | null, sessionId: string | null) => {
    mocks.readSession(engine, sessionId)
    if (!sessionId) return { data: undefined, isLoading: false }
    return { data: { session: matched, entries, totalEntries: 2 }, isLoading: false }
  },
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'Demo', directory: '/app/demo' },
      { id: 'p2', name: 'Other', directory: '/other' },
    ],
  }),
  useDeleteLocalSessions: () => ({
    mutate: mocks.deleteMutate,
    isPending: false,
    data: undefined,
  }),
  useImportSession: () => ({
    mutate: mocks.importMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

vi.mock('@/components/issue-detail/SessionMessages', () => ({
  SessionMessages: ({ logs }: { logs: NormalizedLogEntry[] }) => (
    <div data-testid="transcript">
      {logs.map(entry => <p key={entry.messageId}>{entry.content}</p>)}
    </div>
  ),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <LocalSessionsPage />
    </MemoryRouter>,
  )
}

describe('local sessions page', () => {
  beforeEach(async () => {
    mocks.importMutate.mockReset()
    mocks.deleteMutate.mockReset()
    mocks.listSessions.mockReset()
    mocks.readSession.mockReset()
    await i18n.changeLanguage('en')
  })

  it('requests only sessions that are not tracked in BKD', () => {
    renderPage()
    expect(mocks.listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ managed: 'false' }),
    )
  })

  it('lists sessions whose directory matches a project and ones that do not', () => {
    renderPage()

    expect(screen.getByText('ship the login page')).toBeInTheDocument()
    expect(screen.getByText('unrelated work')).toBeInTheDocument()
    expect(screen.getByText('/somewhere/else')).toBeInTheDocument()
  })

  it('opens the parsed transcript when a session is selected', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /ship the login page/ }))

    expect(mocks.readSession).toHaveBeenCalledWith('claude-code', 'session-matched')
    const detail = screen.getByRole('dialog', { name: 'Session transcript' })
    expect(within(detail).getByTestId('transcript')).toBeInTheDocument()
    expect(within(detail).getByText('on it')).toBeInTheDocument()
    expect(within(detail).getByText('/app/demo')).toBeInTheDocument()
  })

  it('resizes the transcript drawer from the drag handle', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /ship the login page/ }))

    const detail = screen.getByRole('dialog', { name: 'Session transcript' })
    const handle = within(detail).getByRole('separator')
    const before = Number.parseInt(detail.style.width, 10)

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(Number.parseInt(detail.style.width, 10)).toBe(before + 10)

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })
    expect(Number.parseInt(detail.style.width, 10)).toBe(before - 40)
  })

  it('expands the transcript drawer to fullscreen', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /ship the login page/ }))

    const detail = screen.getByRole('dialog', { name: 'Session transcript' })
    fireEvent.click(within(detail).getByRole('button', { name: 'Maximize' }))

    expect(detail.style.width).toBe('')
    expect(within(detail).queryByRole('separator')).not.toBeInTheDocument()
  })

  it('imports a cwd-matching session without extra confirmation', () => {
    renderPage()

    fireEvent.click(screen.getAllByRole('button', { name: 'Import' })[0]!)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))

    expect(mocks.importMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        engine: 'claude-code',
        sessionId: 'session-matched',
        importLogs: true,
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('requires acknowledgement when the session cwd does not match the project', () => {
    renderPage()

    fireEvent.click(screen.getAllByRole('button', { name: 'Import' })[1]!)

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: 'Demo' }))

    expect(within(dialog).getByText(/Follow-up will start a new session/)).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Import' })
    expect(confirm).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(confirm)

    expect(mocks.importMutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', sessionId: 'session-elsewhere' }),
      expect.anything(),
    )
  })
})

describe('local sessions deletion', () => {
  beforeEach(async () => {
    mocks.deleteMutate.mockReset()
    await i18n.changeLanguage('en')
  })

  it('offers no delete control until something is selected', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('confirms before deleting the selected sessions', () => {
    renderPage()

    fireEvent.click(screen.getByRole('checkbox', { name: /ship the login page/ }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/Delete 1 local session/)).toBeInTheDocument()
    // The copy has to say the transcript leaves the disk — this is not a soft delete
    expect(within(dialog).getByText(/removes the transcript from disk/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mocks.deleteMutate).toHaveBeenCalledWith(
      { sessions: [{ engine: 'claude-code', sessionId: 'session-matched' }] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('selects and deselects every row at once', () => {
    renderPage()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })
})
