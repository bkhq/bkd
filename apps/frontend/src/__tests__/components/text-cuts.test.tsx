import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import { NotesDrawer } from '@/components/notes/NotesDrawer'
import i18n from '@/i18n'
import { useNotesStore } from '@/stores/notes-store'

/**
 * One-line summaries are cut by CSS at the row width, never at a fixed number of
 * characters: a fixed cut stops short of the row on a wide screen.
 */

const LONG = `${'word '.repeat(60)}end`

vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ resolved: 'light' }) }))
vi.mock('react-router-dom', () => ({ useParams: () => ({}) }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))
vi.mock('@/hooks/use-notes', () => ({
  useNotes: () => ({ data: [{ id: 'n1', title: 'Plan', content: LONG, isPinned: false, createdAt: '', updatedAt: '2026-10-23T00:00:00Z' }], isLoading: false, isError: false }),
  useCreateNote: () => ({ mutate: vi.fn() }),
  useDeleteNote: () => ({ mutate: vi.fn() }),
  useUpdateNote: () => ({ mutate: vi.fn() }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('one-line summaries', () => {
  it('thinking shows its whole text on one line for CSS to cut', () => {
    render(<LogEntry entry={{ entryType: 'thinking', content: LONG }} />)
    const summary = screen.getByText(/^Thinking:/)
    expect(summary.textContent).toContain('end')
    expect(summary.textContent).not.toContain('…')
    expect(summary).toHaveClass('truncate')
  })

  it('a command outside a tool group is not cut at a fixed length', () => {
    const command = `${'echo step && '.repeat(12)}true`
    render(<LogEntry entry={{ entryType: 'tool-use', content: command, metadata: { toolName: 'Bash' }, toolAction: { kind: 'command-run', command } }} />)
    const label = screen.getByText(/echo step/)
    expect(label.textContent).toContain('true')
    expect(label.textContent).not.toContain('.....')
    expect(label).toHaveClass('truncate')
  })

  it('a note preview is not cut at a fixed length', () => {
    useNotesStore.setState({ isOpen: true, selectedNoteId: null })
    render(<NotesDrawer />)
    const preview = screen.getByText(/^word word/)
    expect(preview.textContent).toContain('end')
    expect(preview).toHaveClass('truncate')
  })
})
