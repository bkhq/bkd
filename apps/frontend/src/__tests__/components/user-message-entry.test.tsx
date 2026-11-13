import type { NormalizedLogEntry } from '@bkd/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import i18n from '@/i18n'
import { useViewModeStore } from '@/stores/view-mode-store'

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

describe('user message body', () => {
  it('shows the Markdown source when the setting is off, like assistant messages', async () => {
    useViewModeStore.setState({ renderMarkdown: false })
    const { container } = renderEntry({ entryType: 'user-message', messageId: 'u3', content: '**Audit**', timestamp: '2026-10-12T09:00:00.000Z' })
    const body = container.querySelector('[data-slot="sender-body"]')!
    await waitFor(() => expect(body.querySelector('.markdown-shiki')).not.toBeNull())
    expect(body).toHaveTextContent('**Audit**')
    expect(body.querySelector('[data-streamdown="strong"]')).toBeNull()
  })

  it('renders Markdown and keeps single line breaks', () => {
    useViewModeStore.setState({ renderMarkdown: true })
    const { container } = renderEntry({
      entryType: 'user-message',
      messageId: 'u2',
      content: '1. **Audit** features\n2. Review code\n\nfirst line\nsecond line',
      timestamp: '2026-10-12T09:00:00.000Z',
    })
    const body = container.querySelector('[data-slot="sender-body"]')!
    expect(body.querySelector('[data-streamdown="strong"]')).toHaveTextContent('Audit')
    expect(body.querySelectorAll('ol li')).toHaveLength(2)
    const paragraph = screen.getByText(/first line/)
    expect(paragraph.tagName).toBe('P')
    expect(body).toHaveClass('[&_p]:whitespace-pre-wrap')
  })
})

describe('user message source toggle', () => {
  it('flips one message between rendered Markdown and its source', () => {
    useViewModeStore.setState({ renderMarkdown: true })
    const { container } = renderEntry({ entryType: 'user-message', messageId: 'u4', content: '**Audit**', timestamp: '2026-10-12T09:00:00.000Z' })
    const body = () => container.querySelector('[data-slot="sender-body"]')!
    expect(body().querySelector('[data-streamdown="strong"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View source' }))
    expect(body().querySelector('.markdown-shiki')).not.toBeNull()
    expect(body().querySelector('[data-streamdown="strong"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View as Markdown' }))
    expect(body().querySelector('[data-streamdown="strong"]')).not.toBeNull()
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
    expect(container.querySelector('[data-slot="chat-block"]')).not.toBeNull()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledOnce()
  })
})
