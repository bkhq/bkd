import type { NormalizedLogEntry } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import i18n from '@/i18n'
import { useViewModeStore } from '@/stores/view-mode-store'

/** View and copy actions on assistant messages. */

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)

vi.mock('@/components/files/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="preview">{content}</div>,
}))

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

  it('offers view, copy text and copy Markdown', () => {
    renderEntry()
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Markdown' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View as Markdown' })).toBeInTheDocument()
  })

  it('opens the rendered message in a dialog', async () => {
    renderEntry()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View as Markdown' }))
    expect(await screen.findByTestId('preview')).toHaveTextContent('Some **bold** text')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('uses the user message card shape with its own colour', () => {
    renderEntry()
    expect(screen.getByTestId('assistant-message-body')).toHaveClass(
      'rounded-lg',
      'border',
      'border-l-[3px]',
      'border-l-primary/60',
      'bg-primary/[0.04]',
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
