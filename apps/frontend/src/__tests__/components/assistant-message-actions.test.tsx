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

  it('always offers exactly two actions: switch the view and copy', () => {
    renderEntry()
    expect(screen.getByRole('button', { name: 'View source' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View source' }))
    expect(screen.getByRole('button', { name: 'View as Markdown' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy (text|Markdown)/ })).toBeNull()
  })

  it('keeps one code icon and highlights it while the source is shown, as in bks', () => {
    renderEntry()
    const toggle = screen.getByRole('button', { name: 'View source' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    const pressed = screen.getByRole('button', { name: 'View as Markdown' })
    expect(pressed).toHaveAttribute('aria-pressed', 'true')
    expect(pressed.querySelector('svg')).toHaveClass('lucide-code', 'text-primary')
  })

  it('toggles this message between rendered Markdown and its source in place', () => {
    renderEntry()
    const body = screen.getByTestId('assistant-message-body')
    expect(body).toHaveTextContent('Some bold text')
    fireEvent.click(screen.getByRole('button', { name: 'View source' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(body).toHaveTextContent('Some **bold** text')
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

  it('uses the shared chat block shape, told apart from user messages by its background', () => {
    renderEntry()
    const body = screen.getByTestId('assistant-message-body')
    expect(body).toHaveClass('rounded-lg', 'bg-card')
    expect(body).not.toHaveClass('border')
  })

  it('copies the rendered text while the message is rendered', async () => {
    renderEntry()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('Some bold text')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('copies the Markdown source while the source is shown', () => {
    renderEntry()
    fireEvent.click(screen.getByRole('button', { name: 'View source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('Some **bold** text')
  })
})
