import type { NormalizedLogEntry } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import i18n from '@/i18n'
import { useViewModeStore } from '@/stores/view-mode-store'

/** View and copy actions on assistant messages. */

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)

const entry: NormalizedLogEntry = {
  entryType: 'assistant-message',
  messageId: 'm1',
  content: 'Some **bold** text',
  timestamp: '2026-09-09T04:00:00.000Z',
}

function renderEntry() {
  return render(
    <MemoryRouter>
      <LogEntry entry={entry} />
    </MemoryRouter>,
  )
}

describe('assistant message actions', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useViewModeStore.setState({ renderMarkdown: true })
    writeText.mockClear()
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('offers view source, copy text and copy Markdown on a rendered message', () => {
    renderEntry()
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Markdown' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View source' })).toBeInTheDocument()
  })

  it('toggles this message between rendered Markdown and its source in place', () => {
    renderEntry()
    const body = screen.getByTestId('assistant-message-body')
    expect(body).toHaveTextContent('Some bold text')
    fireEvent.click(screen.getByRole('button', { name: 'View source' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(body).toHaveTextContent('Some **bold** text')
    // In source view the text is the source, so only copy Markdown remains
    expect(screen.queryByRole('button', { name: 'Copy text' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View as Markdown' }))
    expect(body).toHaveTextContent('Some bold text')
  })

  it('starts in source view when the setting turns rendering off, and can render one message', () => {
    useViewModeStore.setState({ renderMarkdown: false })
    renderEntry()
    const body = screen.getByTestId('assistant-message-body')
    expect(body).toHaveTextContent('Some **bold** text')
    fireEvent.click(screen.getByRole('button', { name: 'View as Markdown' }))
    expect(body).toHaveTextContent('Some bold text')
  })

  it('uses the user message card shape with its own colour', () => {
    renderEntry()
    expect(screen.getByTestId('assistant-message-body')).toHaveClass(
      'rounded-lg',
      'border',
      'border-l-[3px]',
      'border-l-primary/60',
      'bg-muted/30',
    )
  })

  it('copy text writes the rendered text without markup', async () => {
    renderEntry()
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    expect(writeText).toHaveBeenCalledWith('Some bold text')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('copy Markdown writes the source verbatim', () => {
    renderEntry()
    fireEvent.click(screen.getByRole('button', { name: 'Copy Markdown' }))
    expect(writeText).toHaveBeenCalledWith('Some **bold** text')
  })

  it('offers only copy Markdown in source view, where text and source are identical', () => {
    useViewModeStore.setState({ renderMarkdown: false })
    renderEntry()
    expect(screen.queryByRole('button', { name: 'Copy text' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy Markdown' })).toBeInTheDocument()
  })
})
