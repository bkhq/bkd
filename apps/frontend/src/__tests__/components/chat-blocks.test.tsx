import type { NormalizedLogEntry } from '@bkd/shared'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import i18n from '@/i18n'

/**
 * Every block in the chat shares one shape: the same radius and the same
 * padding. Messages have no outline and are told apart by background colour;
 * tool groups and command output keep a 1px outline.
 */

vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ resolved: 'light' }) }))

const OUTLINED = new Set(['command output'])

const ENTRIES: [string, NormalizedLogEntry][] = [
  ['user', { entryType: 'user-message', content: 'Hello' }],
  ['pending user', { entryType: 'user-message', content: 'Queued', metadata: { type: 'pending' } }],
  ['done user', { entryType: 'user-message', content: 'Done', metadata: { type: 'done' } }],
  ['assistant', { entryType: 'assistant-message', content: 'Reply' }],
  ['thinking', { entryType: 'thinking', content: 'Pondering' }],
  ['error', { entryType: 'error-message', content: 'Boom' }],
  ['command output', { entryType: 'system-message', content: 'Context\nusage', metadata: { subtype: 'command_output' } }],
]

describe('chat blocks', () => {
  it.each(ENTRIES)('%s uses the shared block shape', (name, entry) => {
    const { container } = render(<MemoryRouter><LogEntry entry={entry} /></MemoryRouter>)
    const block = container.querySelector('[data-slot="chat-block"]')
    expect(block).not.toBeNull()
    expect(block).toHaveClass('rounded-lg')
    if (OUTLINED.has(name)) expect(block).toHaveClass('border', 'border-border')
    else expect(block!.className).not.toMatch(/(^|\s)border(-|\s|$)/)
    // Same vertical rhythm around every block
    expect(block!.closest('[data-slot="chat-block-row"]')).toHaveClass('py-1.5')
  })

  it('tints user messages with the primary colour so they stand out from assistant replies', () => {
    const user = render(<MemoryRouter><LogEntry entry={ENTRIES[0]![1]} /></MemoryRouter>)
    expect(user.container.querySelector('[data-slot="chat-block"]')).toHaveClass('bg-primary/[0.06]')
    user.unmount()
    const assistant = render(<MemoryRouter><LogEntry entry={ENTRIES[3]![1]} /></MemoryRouter>)
    expect(assistant.container.querySelector('[data-slot="chat-block"]')).toHaveClass('bg-card')
  })

  it('puts user messages on the right as a bubble sized to its text', () => {
    const { container } = render(<MemoryRouter><LogEntry entry={ENTRIES[0]![1]} /></MemoryRouter>)
    expect(container.querySelector('[data-slot="chat-block-row"]')).toHaveClass('items-end')
    expect(container.querySelector('[data-slot="chat-block"]')).toHaveClass('w-fit', 'max-w-[85%]')
  })

  it('keeps queued messages on the left', () => {
    const entry = { ...ENTRIES[0]![1], metadata: { type: 'pending' } }
    const { container } = render(<MemoryRouter><LogEntry entry={entry} /></MemoryRouter>)
    expect(container.querySelector('[data-slot="chat-block-row"]')).not.toHaveClass('items-end')
  })

  it('keeps assistant replies on the left at full width', () => {
    const { container } = render(<MemoryRouter><LogEntry entry={ENTRIES[3]![1]} /></MemoryRouter>)
    expect(container.querySelector('[data-slot="chat-block-row"]')).not.toHaveClass('items-end')
    expect(container.querySelector('[data-slot="chat-block"]')).not.toHaveClass('w-fit')
  })

  it.each([ENTRIES[0]!, ENTRIES[3]!])('%s shows its actions all the time, not only on hover', async (_name, entry) => {
    await i18n.changeLanguage('en')
    const { container } = render(<MemoryRouter><LogEntry entry={entry} /></MemoryRouter>)
    const copy = container.querySelector('button[aria-label^="Copy"]')
    expect(copy).not.toBeNull()
    expect(copy!.closest('[class*="opacity-0"]')).toBeNull()
  })

  it.each([ENTRIES[0]!, ENTRIES[3]!])('%s actions share the timestamp colour, brightening with it on hover', async (_name, entry) => {
    await i18n.changeLanguage('en')
    const { container } = render(<MemoryRouter><LogEntry entry={{ ...entry, timestamp: '2026-10-23T08:00:00.000Z' }} /></MemoryRouter>)
    const footer = container.querySelector('[data-slot="chat-block"]')!.nextElementSibling!
    const time = footer.querySelector('span')!
    expect(time).toHaveClass('text-muted-foreground/30', 'group-hover:text-muted-foreground/60')
    for (const button of footer.querySelectorAll('button')) {
      expect(button).toHaveClass('text-muted-foreground/30', 'group-hover:text-muted-foreground/60')
    }
  })

  it('pads an assistant reply like a user message, inside its card background', () => {
    const { container } = render(<MemoryRouter><LogEntry entry={ENTRIES[3]![1]} /></MemoryRouter>)
    expect(container.querySelector('[data-slot="chat-block"]')).toHaveClass('px-3', 'py-2')
    const user = render(<MemoryRouter><LogEntry entry={ENTRIES[0]![1]} /></MemoryRouter>)
    expect(user.container.querySelector('[data-slot="chat-block"]')).toHaveClass('px-3')
  })
})
