import type { LocalSession } from '@bkd/shared'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import LocalSessionsPage from '@/pages/LocalSessionsPage'

/** Local session listing and import dialog (SES-001). */

const mocks = vi.hoisted(() => ({
  importMutate: vi.fn(),
}))

const matched: LocalSession = {
  engine: 'claude-code',
  sessionId: 'session-matched',
  cwd: '/app/demo',
  title: 'ship the login page',
  lastActiveAt: '2026-08-20T00:00:00.000Z',
  sizeBytes: 2048,
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

const managed: LocalSession = {
  engine: 'claude-code',
  sessionId: 'session-managed',
  cwd: '/app/demo',
  title: 'already tracked',
  lastActiveAt: '2026-08-18T00:00:00.000Z',
  sizeBytes: 512,
  managedByIssueId: 'i1',
  managedByProjectId: 'p1',
}

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ resolved: 'light' }),
}))

vi.mock('@/hooks/use-kanban', () => ({
  useLocalSessions: () => ({
    data: { sessions: [matched, mismatched, managed], total: 3, hasMore: false },
    isLoading: false,
  }),
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'Demo', directory: '/app/demo' },
      { id: 'p2', name: 'Other', directory: '/other' },
    ],
  }),
  useImportSession: () => ({
    mutate: mocks.importMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
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
    await i18n.changeLanguage('en')
  })

  it('lists matching and non-matching sessions together', () => {
    renderPage()

    expect(screen.getByText('ship the login page')).toBeInTheDocument()
    expect(screen.getByText('unrelated work')).toBeInTheDocument()
    expect(screen.getByText('/somewhere/else')).toBeInTheDocument()
  })

  it('marks sessions that already belong to an issue and blocks re-import', () => {
    renderPage()

    expect(screen.getByText('In BKD')).toBeInTheDocument()
    const importButtons = screen.getAllByRole('button', { name: 'Import' })
    expect(importButtons.at(-1)).toBeDisabled()
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
