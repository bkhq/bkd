import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LogEntry } from '@/components/issue-detail/LogEntry'
import type { TimelineEntry } from '@/types/kanban'

// ────────────────────────────────────────────────────────────────────────────
// Invariant: assistant-message Copy button writes the RAW markdown source to
// the clipboard, not the rendered HTML/text.
//
// Why this test exists: the MarkdownContent rewrite swapped the
// Shiki-tokenized raw-source view for a react-markdown rendered HTML view.
// The visual result is correct (no `**`/`#`/table-pipe litter) but it broke
// the previous "select + Ctrl+C → raw markdown" UX that users had built
// muscle memory around. The Copy button must remain a reliable escape hatch
// — i.e. clicking it produces the original markdown source, not the
// rendered DOM text content.
// ────────────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

// MarkdownContent is lazy-loaded with Shiki / Mermaid suspensions that don't
// resolve in jsdom. Stub it to a plain div with the rendered text — the test
// focuses on the clipboard payload, not on the markdown renderer itself.
vi.mock('@/components/issue-detail/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="rendered-markdown">{content.replace(/[*#|\-`]/g, '')}</div>
  ),
}))

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

/**
 * AssistantMessage now consults `useFilePreview` to wire inline path chips.
 * That hook hangs off React Query (`useIssueChanges`) and `useParams`, so
 * the test tree needs both providers. We use a no-network QueryClient and a
 * MemoryRouter — `useFilePreview` reports `hasPreview === false` outside an
 * issue route, which keeps this test focused on copy behavior.
 */
function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function makeAssistantEntry(content: string): TimelineEntry {
  return {
    id: 'turn-0-assistant-0000',
    messageId: 'm1',
    turnIndex: 0,
    type: 'assistant',
    entryType: 'assistant-message',
    content,
    timestamp: '2026-01-01T00:00:00Z',
    sequence: new Date('2026-01-01T00:00:00Z').getTime() * 1000,
    metadata: {},
  }
}

describe('assistant message copy', () => {
  it('copy button writes the raw markdown source to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })

    const raw = '# Heading\n\n**bold** and `code`\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    renderWithProviders(<LogEntry entry={makeAssistantEntry(raw)} />)

    // Button is always discoverable — the tooltip key surfaces it.
    const copyButton = screen.getByTitle('session.copyMessage')
    fireEvent.click(copyButton)

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText).toHaveBeenCalledWith(raw)
  })

  it('copy button is not opacity:0 — users must be able to find it', () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      writable: true,
      configurable: true,
    })
    renderWithProviders(<LogEntry entry={makeAssistantEntry('hello')} />)
    const copyButton = screen.getByTitle('session.copyMessage')
    // The previous implementation used `opacity-0 group-hover:opacity-100`
    // which made the button effectively invisible. Pin the regression: the
    // baseline class list must NOT contain `opacity-0`.
    expect(copyButton.className).not.toMatch(/(^|\s)opacity-0(\s|$)/)
  })
})
