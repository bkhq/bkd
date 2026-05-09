import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { useAcpTimeline } from '@/hooks/use-acp-timeline'
import type { NormalizedLogEntry } from '@/types/kanban'

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

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function rebuildAcpTimeline(logs: NormalizedLogEntry[]) {
  const { result } = renderHook(() => useAcpTimeline(logs), { wrapper: createWrapper() })
  return result.current
}

describe('useAcpTimeline thinking dedup', () => {
  it('discards thinking when assistant contains same content on final flush', () => {
    // Regression: OpenCode streams thinking and assistant as identical text.
    // When flushStreamingAssistant runs at turn end, pendingThinking must be
    // discarded if pendingStreamingAssistant already contains the same content.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '用户问为什么测试兜不住',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer，没测前端 state 的去重',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Should only have 1 item: the final assistant message
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    const entry0 = items[0] as { entry: NormalizedLogEntry }
    expect(entry0.entry.entryType).toBe('assistant-message')
    expect(entry0.entry.content).toBe(
      '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer，没测前端 state 的去重',
    )

    // Thinking should be discarded (merged into assistant)
    expect(items.some(i => i.type === 'thinking')).toBe(false)
  })

  it('keeps standalone thinking when assistant does NOT overlap', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the imports first',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue in the type definitions',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Thinking comes before assistant in items
    expect(items).toHaveLength(2)
    expect(items[0]!.type).toBe('thinking')
    expect((items[0] as { entry: NormalizedLogEntry }).entry.entryType).toBe('thinking')
    expect((items[0] as { entry: NormalizedLogEntry }).entry.content).toBe('Let me check the imports first')

    expect(items[1]!.type).toBe('entry')
    expect((items[1] as { entry: NormalizedLogEntry }).entry.entryType).toBe('assistant-message')
  })

  it('discards thinking when assistant comes after tool calls', () => {
    // Real-world OpenCode pattern: thinking → tool → assistant (thinking content
    // is a superset that spans across the tool call).
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '用户问为什么测试兜不住',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'tool-use',
        content: 'Read src/app.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Should have 2 items: tool-group + assistant (thinking discarded by assistant).
    // The thinking before the tool call is kept pending, then discarded when
    // the assistant arrives with the same content.
    expect(items).toHaveLength(2)
    expect(items[0]!.type).toBe('tool-group')
    expect(items[1]!.type).toBe('entry')
    const assistantItem = items[1] as { entry: NormalizedLogEntry }
    expect(assistantItem.entry.entryType).toBe('assistant-message')

    // Thinking should be discarded (merged into assistant)
    expect(items.some(i => i.type === 'thinking')).toBe(false)
  })
})
