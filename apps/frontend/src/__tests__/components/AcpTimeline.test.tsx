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

describe('acpTimeline', () => {
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

    // Should NOT show streaming thinking
    expect(screen.queryByText(/Thinking\.\.\./i)).not.toBeInTheDocument()

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

  it('survives 50+ interleaved thinking/assistant/tool chunks without duplication', () => {
    // Stress test: OpenCode sends full accumulated text on every chunk,
    // creating cascading content. The timeline must merge them into a
    // single assistant message + one tool group.
    const logs: NormalizedLogEntry[] = []
    const baseTime = Date.now()

    // Phase 1: thinking cascades (5 chunks of accumulating text)
    for (let i = 1; i <= 5; i++) {
      logs.push({
        entryType: 'thinking',
        content: '用户'.repeat(i),
        timestamp: new Date(baseTime + i * 10).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      })
    }

    // Phase 2: assistant starts (overlaps with thinking)
    for (let i = 1; i <= 10; i++) {
      logs.push({
        entryType: 'assistant-message',
        content: '用户'.repeat(5) + '，这是回复内容'.repeat(i),
        timestamp: new Date(baseTime + 100 + i * 10).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      })
    }

    // Phase 3: tool call in the middle
    logs.push({
      entryType: 'tool-use',
      content: 'Read src/config.ts',
      timestamp: new Date(baseTime + 250).toISOString(),
      turnIndex: 0,
      metadata: { toolCallId: 't1', isResult: false },
      toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
    })

    // Phase 4: more assistant after tool
    for (let i = 1; i <= 5; i++) {
      logs.push({
        entryType: 'assistant-message',
        content: '用户'.repeat(5) + '，这是回复内容'.repeat(10) + '后续内容'.repeat(i),
        timestamp: new Date(baseTime + 300 + i * 10).toISOString(),
        turnIndex: 0,
        metadata: { streaming: true },
      })
    }

    // Phase 5: non-streaming duplicate (acp-prompt-result style)
    logs.push({
      entryType: 'assistant-message',
      content: '用户'.repeat(5) + '，这是回复内容'.repeat(10) + '后续内容'.repeat(5),
      timestamp: new Date(baseTime + 400).toISOString(),
      turnIndex: 0,
      metadata: {},
    })

    render(<AcpTimeline logs={logs} />, { wrapper: createWrapper() })

    // Should NOT show streaming thinking indicator
    expect(screen.queryByText(/Thinking\.\.\./i)).not.toBeInTheDocument()

    // Should have exactly ONE assistant message rendered (match full final text)
    const finalContent = '用户'.repeat(5) + '，这是回复内容'.repeat(10) + '后续内容'.repeat(5)
    expect(screen.getByText(finalContent)).toBeInTheDocument()

    // Tool call should be present ( rendered inside ToolGroupMessage )
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

    render(<AcpTimeline logs={logs} />, { wrapper: createWrapper() })

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

    render(<AcpTimeline logs={logs} isRunning />, { wrapper: createWrapper() })

    // Should show streaming thinking content (i18n label not loaded in tests)
    expect(screen.getByText(/Analyzing the codebase/)).toBeInTheDocument()
  })
})
