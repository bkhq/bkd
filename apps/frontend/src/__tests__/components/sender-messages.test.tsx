import type { NormalizedLogEntry } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import i18n from '@/i18n'

/** Follow-ups sent by another issue's agent or by BKD itself, set apart from the user's own messages. */

vi.mock('@/hooks/use-kanban', () => ({
  useIssue: (projectId: string, issueId: string) => ({
    data: projectId === 'p2' && issueId === 'l2' ? { id: 'l2', issueNumber: 7, title: '[L2] api: split routes' } : undefined,
  }),
}))

function renderEntry(metadata: Record<string, unknown>, content = 'Implement step 3') {
  const entry: NormalizedLogEntry = { entryType: 'user-message', messageId: 'm1', content, timestamp: '2026-10-24T09:00:00.000Z', metadata }
  return render(<MemoryRouter><LogEntry entry={entry} /></MemoryRouter>)
}

describe('sender messages', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows an agent follow-up on the left with a link to the sending issue', () => {
    const { container } = renderEntry({ sender: { kind: 'agent', projectId: 'p2', issueId: 'l2' } })
    const row = container.querySelector('[data-slot="chat-block-row"]')!
    expect(row).not.toHaveClass('items-end')
    expect(row).toHaveAttribute('data-sender', 'agent')
    expect(screen.getByRole('link', { name: /#7 \[L2\] api: split routes/ })).toHaveAttribute('href', '/projects/p2/issues/l2')
    expect(screen.getByText('Implement step 3')).toBeInTheDocument()
  })

  it('folds a long agent follow-up until expanded', () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const { container } = renderEntry({ sender: { kind: 'agent', projectId: 'p2', issueId: 'l2' } }, long)
    const body = container.querySelector('[data-slot="sender-body"]')!
    expect(body).toHaveClass('line-clamp-8')
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(body).not.toHaveClass('line-clamp-8')
  })

  it('shows a system wake as a compact system row', () => {
    const { container } = renderEntry({ sender: { kind: 'system', via: 'message' } }, '[message-reply messageId=01ABC]')
    const row = container.querySelector('[data-slot="chat-block-row"]')!
    expect(row).toHaveAttribute('data-sender', 'system')
    expect(row).not.toHaveClass('items-end')
    expect(screen.getByText('Message reply')).toBeInTheDocument()
  })

  it('keeps the queued badge on a queued agent follow-up', () => {
    renderEntry({ type: 'pending', sender: { kind: 'agent', projectId: 'p2', issueId: 'l2' } })
    expect(screen.getByText('Queued')).toBeInTheDocument()
  })

  it('leaves the user\'s own message as the right-hand bubble', () => {
    const { container } = renderEntry({})
    const row = container.querySelector('[data-slot="chat-block-row"]')!
    expect(row).toHaveClass('items-end')
    expect(row).not.toHaveAttribute('data-sender')
  })
})
