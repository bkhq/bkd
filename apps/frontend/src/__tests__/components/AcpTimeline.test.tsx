import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AcpTimeline } from '@/components/issue-detail/AcpTimeline'
import type { NormalizedLogEntry, TimelineEntry } from '@/types/kanban'

// Mock react-i18next to avoid i18n initialization in tests
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

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
      'thinking': 'thinking',
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
    expect(screen.queryByText('session.thinking')).not.toBeInTheDocument()

    // Should have exactly ONE assistant message rendered
    expect(screen.getByText(finalContent)).toBeInTheDocument()

    // Tool call body is collapsed by default — expand it first
    const toolHeader = screen.getByRole('button', { expanded: false })
    fireEvent.click(toolHeader)

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

    // Completed thinking is collapsed by default — click to expand
    const thinkingButton = screen.getByText('session.thoughtProcess')
    expect(thinkingButton).toBeInTheDocument()

    // Click to expand
    fireEvent.click(thinkingButton)

    // Should show thinking content after expand
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

  it('keeps thinking block even when assistant repeats the same prefix', () => {
    // Models commonly open the reply with the same opening sentence as the
    // reasoning. The old startsWith-dedup silently dropped the thinking
    // block in that case — users perceived it as "thinking disappeared
    // after refresh". Now thinking is its own surface; collapse it via the
    // <details> element if visual duplication bothers you.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '让我分析这个问题',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: false },
      },
      {
        entryType: 'assistant-message',
        content: '让我分析这个问题\n\n答案是42',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    render(<AcpTimeline logs={toTimeline(logs)} />, { wrapper: createWrapper() })

    // Thinking block is rendered (i18n label visible).
    expect(screen.getByText('session.thoughtProcess')).toBeInTheDocument()
    // Assistant body is rendered.
    expect(screen.getByText(/答案是42/)).toBeInTheDocument()
  })

  it('preserves thinking block when assistant has different content', () => {
    // Normal case: thinking and assistant are distinct — both should show.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the logs',
        timestamp: new Date().toISOString(),
        turnIndex: 0,
        metadata: { streaming: false },
      },
      {
        entryType: 'assistant-message',
        content: 'The error is on line 42',
        timestamp: new Date(Date.now() + 100).toISOString(),
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    render(<AcpTimeline logs={toTimeline(logs)} />, { wrapper: createWrapper() })

    // Should show the thinking block
    expect(screen.getByText('session.thoughtProcess')).toBeInTheDocument()

    // Should show the assistant message
    expect(screen.getByText(/The error is on line 42/)).toBeInTheDocument()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Auto-load older history — IntersectionObserver wiring.
// Mirror of the SessionMessages regression test. AcpTimeline is the path
// opencode / gemini issues take, so without this guard the scroll-up-to-
// load bug would have stayed alive for ACP engines even after the legacy
// (Claude / codex) path was fixed.
// ────────────────────────────────────────────────────────────────────────────

let observerCallback: IntersectionObserverCallback | null = null
const observeMock = vi.fn()
const disconnectMock = vi.fn()

class MockIntersectionObserver implements IntersectionObserver {
  root: Element | Document | null = null
  rootMargin = ''
  thresholds: ReadonlyArray<number> = []

  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    observerCallback = cb
    this.root = (opts?.root as Element | Document | null) ?? null
  }

  observe = observeMock
  disconnect = disconnectMock
  unobserve = vi.fn()
  takeRecords = (): IntersectionObserverEntry[] => []
}

describe('acpTimeline — auto-load older history', () => {
  beforeEach(() => {
    observerCallback = null
    observeMock.mockClear()
    disconnectMock.mockClear()
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    // jsdom doesn't implement Element.scrollTo; AcpTimeline calls it after
    // messages arrive. Stub so the auto-bottom effect doesn't throw mid-rerender.
    Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo']
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  interface HarnessProps {
    logs: TimelineEntry[]
    hasOlderLogs?: boolean
    isLoadingOlder?: boolean
    onLoadOlder?: () => void
  }

  function Harness({ logs, hasOlderLogs, isLoadingOlder, onLoadOlder }: HarnessProps) {
    const scrollRef = useRef<HTMLDivElement>(null)
    return (
      <div ref={scrollRef} data-testid="scroll" style={{ height: 500, overflow: 'auto' }}>
        <AcpTimeline
          logs={logs}
          scrollRef={scrollRef}
          hasOlderLogs={hasOlderLogs}
          isLoadingOlder={isLoadingOlder}
          onLoadOlder={onLoadOlder}
        />
      </div>
    )
  }

  function userEntry(messageId: string, content: string): TimelineEntry {
    return {
      id: `turn-0-user-${messageId}`,
      messageId,
      turnIndex: 0,
      type: 'user',
      entryType: 'user-message',
      content,
      timestamp: new Date().toISOString(),
      sequence: 1000,
      metadata: {},
    } as TimelineEntry
  }

  it('attaches the observer when items arrive after an empty initial render', () => {
    // Regression (companion to SessionMessages test of the same name):
    // ACP-engine issues take the AcpTimeline path. On switching to a
    // review/done ACP issue, the initial render has items=[] + !isRunning,
    // so `if (items=0 && pending=0 && !isRunning) return null` hides the
    // top sentinel. The IntersectionObserver useEffect runs with sentinel
    // = null and bails out. When logs arrive later, the deps
    // [scrollRef, onLoadOlder] are unchanged → effect doesn't re-run →
    // observer never attaches → scroll-up loads nothing.
    //
    // Fix added `items.length` to the deps so the second render re-runs
    // the effect and attaches the observer.
    const onLoadOlder = vi.fn()
    const { rerender } = render(
      <Harness logs={[]} hasOlderLogs onLoadOlder={onLoadOlder} />,
      { wrapper: createWrapper() },
    )

    // Empty initial: component returned null, sentinel was never mounted,
    // observer.observe must not have been called.
    expect(observeMock).not.toHaveBeenCalled()

    // Logs arrive: parent re-renders with a populated array. The fixed
    // effect must re-run and bind the observer to the now-mounted sentinel.
    rerender(<Harness logs={[userEntry('a', 'hello')]} hasOlderLogs onLoadOlder={onLoadOlder} />)

    expect(observeMock).toHaveBeenCalledTimes(1)

    // And the end-to-end wiring still fires onLoadOlder on intersection.
    if (!observerCallback) throw new Error('IntersectionObserver was never constructed')
    observerCallback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })
})
