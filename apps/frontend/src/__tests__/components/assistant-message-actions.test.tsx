import type { NormalizedLogEntry } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import i18n from '@/i18n'

/** Footer copy actions on assistant messages (UI-009). */

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
    writeText.mockClear()
    Object.assign(navigator, { clipboard: { writeText } })
  })

  it('offers copy text and copy Markdown in the footer, without the view dialog', () => {
    renderEntry()
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Markdown' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View as Markdown' })).toBeNull()
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
})
