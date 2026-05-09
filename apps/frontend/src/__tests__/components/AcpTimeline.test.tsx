import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { AcpTimeline } from '@/components/issue-detail/AcpTimeline'
import type { NormalizedLogEntry } from '@/types/kanban'

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

describe('AcpTimeline', () => {
  it('renders a single assistant message when thinking and message share content', () => {
    // Regression: OpenCode sends thinking chunks with the same content as
    // assistant-message. The UI should not show a separate thinking entry.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '用户问为什么测试兜不住',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    render(<AcpTimeline logs={logs} />, { wrapper: createWrapper() })

    // Should NOT show a "Thinking:" summary
    expect(screen.queryByText(/Thinking:/i)).not.toBeInTheDocument()

    // Should show the full assistant message
    expect(screen.getByText(/用户问为什么测试兜不住/)).toBeInTheDocument()
  })

  it('merges cascading assistant chunks into one entry', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'Hel',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'Hello',
        timestamp: new Date(Date.now() + 50).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'Hello world',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    render(<AcpTimeline logs={logs} />, { wrapper: createWrapper() })

    // Only one assistant message should be rendered
    const messages = screen.getAllByText(/Hello/)
    expect(messages.length).toBe(1)
    expect(messages[0]).toHaveTextContent('Hello world')
  })

  it('shows standalone thinking when it does NOT overlap with assistant', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the imports first',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue in the type definitions',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    render(<AcpTimeline logs={logs} />, { wrapper: createWrapper() })

    // Should show the thinking entry
    expect(screen.getByText(/Thinking:/i)).toBeInTheDocument()

    // Should also show the assistant message
    expect(screen.getByText(/I found the issue/)).toBeInTheDocument()
  })
})
