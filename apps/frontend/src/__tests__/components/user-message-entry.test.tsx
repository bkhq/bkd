import type { NormalizedLogEntry } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import i18n from '@/i18n'

/** Footer (timestamp + copy) on sent messages. */

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)

function renderEntry(entry: NormalizedLogEntry) {
  return render(
    <MemoryRouter>
      <LogEntry entry={entry} />
    </MemoryRouter>,
  )
}

describe('user message footer', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    writeText.mockClear()
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('shows the timestamp and copies the text without the attached-files block', async () => {
    renderEntry({
      entryType: 'user-message',
      messageId: 'u1',
      content: 'Please fix it\n\n--- Attached files ---\n[Attached file: a.png at /tmp/a.png]\n',
      timestamp: '2026-10-12T09:00:00.000Z',
      metadata: { attachments: [{ id: 'att1', name: 'a.png', mimeType: 'image/png', size: 10 }] },
    })
    expect(screen.getByText(/2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    expect(writeText).toHaveBeenCalledWith('Please fix it')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('keeps the queued badge next to the timestamp', () => {
    renderEntry({
      entryType: 'user-message',
      content: 'later',
      timestamp: '2026-10-12T09:00:00.000Z',
      metadata: { type: 'pending' },
    })
    const badge = screen.getByText('Queued')
    expect(badge.parentElement).toContainElement(screen.getByText(/2026/))
  })
})

describe('queued message card', () => {
  it('reuses the sent-message card with an edit action and explicit ids', async () => {
    const { UserMessageEntry } = await import('@/components/issue-detail/LogEntry')
    const onEdit = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <UserMessageEntry
          entry={{ entryType: 'user-message', messageId: 'q1', content: 'later', timestamp: '2026-10-12T09:00:00.000Z', metadata: { type: 'pending' } }}
          projectId="p1"
          issueId="i1"
          onEdit={onEdit}
        />
      </MemoryRouter>,
    )
    expect(container.querySelector('.rounded-lg.border')).not.toBeNull()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledOnce()
  })
})
