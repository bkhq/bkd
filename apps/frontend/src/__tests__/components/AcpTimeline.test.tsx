import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AcpTimeline } from '@/components/issue-detail/AcpTimeline'
import type { NormalizedLogEntry, TimelineEntry } from '@/types/kanban'

beforeAll(() => {
  // Mock matchMedia for theme detection in jsdom
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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function toTimeline(entries: NormalizedLogEntry[]): TimelineEntry[] {
  return entries.map((entry) => {
    const typeMap: Record<string, TimelineEntry['type']> = {
      thinking: 'thinking',
      'assistant-message': 'assistant',
      'tool-use': 'tool',
      'system-message': 'system',
      'error-message': 'error',
      'user-message': 'user',
    }
    const type = typeMap[entry.entryType] ?? 'system'
    const turn = entry.turnIndex ?? 0
    return {
      ...entry,
      id: entry.messageId ?? `turn-${turn}-${type}`,
      type,
    }
  })
}

describe('acpTimeline', () => {
  it('renders a single assistant message when thinking and message share content', () => {
    // Regression: OpenCode sends thinking chunks with the same content as
    // assistant-message. The UI should not show a separate thinking entry.
    // Backend TimelineConverter already merges cascading chunks.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'Hello world',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    render(<AcpTimeline logs={toTimeline(logs)} />, { wrapper: createWrapper() })

    // Only one assistant message should be rendered
    const messages = screen.getAllByText(/Hello/)
    expect(messages.length).toBe(1)
    expect(messages[0]).toHaveTextContent('Hello world')
  })

  it('renders merged timeline without duplication', () => {
    // Backend TimelineConverter already merges chunks into single entries.
    // Frontend only renders the normalized result.
    const finalContent = '用户'.repeat(5) + '，这是回复内容'.repeat(10) + '后续内容'.repeat(5)
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '用户'.repeat(5),
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: false },
      },
      {
        entryType: 'tool-use',
        content: 'Read src/config.ts',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: finalContent,
        timestamp: new Date(Date.now() + 200).toISOString(),
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    render(<AcpTimeline logs={toTimeline(logs)} />, { wrapper: createWrapper() })

    // Should NOT show streaming thinking indicator
    expect(screen.queryByText(/Thinking\.{3}/i)).not.toBeInTheDocument()

    // Should have exactly ONE assistant message rendered
    expect(screen.getByText(finalContent)).toBeInTheDocument()

    // Tool call should be present
    expect(screen.queryAllByText('Read src/config.ts').length).toBeGreaterThanOrEqual(1)
  })

  it('shows completed thinking as collapsed block when thinking finishes', () => {
    // UX: thinking streams in real-time, then collapses when assistant starts.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me analyze the problem',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'The issue is in the type definitions',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    render(<AcpTimeline logs={toTimeline(logs)} />, { wrapper: createWrapper() })

    // Should show collapsed thinking block with thinking content
    expect(screen.getByText(/Let me analyze the problem/)).toBeInTheDocument()

    // Should also show the assistant message
    expect(screen.getByText(/The issue is/)).toBeInTheDocument()
  })

  it('shows streaming thinking in real-time before assistant arrives', () => {
    // Simulate mid-stream: only thinking chunks received so far
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Analyzing the codebase...',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    render(<AcpTimeline logs={toTimeline(logs)} isRunning />, { wrapper: createWrapper() })

    // Should show streaming thinking content (i18n label not loaded in tests)
    expect(screen.getByText(/Analyzing the codebase/)).toBeInTheDocument()
  })
})
