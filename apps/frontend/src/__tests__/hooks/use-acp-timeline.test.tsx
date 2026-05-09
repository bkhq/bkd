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

describe('useAcpTimeline streaming merge regression', () => {
  it('does NOT concatenate unrelated assistant chunks', () => {
    // Regression: when assistant chunks are not superset/subset,
    // they must NOT be concatenated into garbled text.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'Hello world',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'Hi there',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Should NOT produce "Hello worldHi there"
    const assistantContents = items
      .filter(i => i.type === 'entry')
      .map(i => (i as { entry: NormalizedLogEntry }).entry.content)

    const concatenated = assistantContents.some(c =>
      c.includes('Hello world') && c.includes('Hi there'),
    )
    expect(concatenated).toBe(false)
  })

  it('handles cascading accumulated text correctly', () => {
    // ACP agents send full accumulated text on every chunk.
    // Should keep only the latest full text.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'B里还留着历史销售记录',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'B里还留着历史销售记录，月份的报表',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'B里还留着历史销售记录，月份的报表还能看到这个"派对套餐"',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    const entry = items[0] as { entry: NormalizedLogEntry }
    expect(entry.entry.content).toBe(
      'B里还留着历史销售记录，月份的报表还能看到这个"派对套餐"',
    )
  })

  it('keeps standalone thinking when assistant only partially overlaps', () => {
    // Regression: thinking contains additional content not in assistant.
    // Should keep thinking as standalone (not discard it).
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me analyze the SQL query carefully. The issue is in the JOIN clause.',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
      },
      {
        entryType: 'assistant-message',
        content: 'Let me analyze the SQL query carefully. Here is the fix:',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Both thinking and assistant should be present
    expect(items).toHaveLength(2)
    expect(items[0]!.type).toBe('thinking')
    expect(items[1]!.type).toBe('entry')
    const assistant = items[1] as { entry: NormalizedLogEntry }
    expect(assistant.entry.entryType).toBe('assistant-message')
  })

  it('outputs non-streaming thinking immediately without merging', () => {
    // Regression: Codex engine produces multiple non-streaming thinking entries
    // (reasoning items without streaming flag). They must NOT be concatenated.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the imports first',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        // No metadata.streaming — simulates Codex reasoning item
      },
      {
        entryType: 'thinking',
        content: 'Now let me read the actions file',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        // No metadata.streaming
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue in the type definitions',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Should have 3 items: 2 thinking + 1 assistant
    expect(items).toHaveLength(3)
    expect(items[0]!.type).toBe('thinking')
    expect((items[0] as { entry: NormalizedLogEntry }).entry.content).toBe('Let me check the imports first')
    expect(items[1]!.type).toBe('thinking')
    expect((items[1] as { entry: NormalizedLogEntry }).entry.content).toBe('Now let me read the actions file')
    expect(items[2]!.type).toBe('entry')
  })

  it('stable order regardless of event arrival order', () => {
    // Regression: order depends on event arrival timing.
    // Reordering the same entries should produce the same output.
    const baseEntries: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'I need to check the database',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'tool-use',
        content: 'Read db/schema.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const order1 = rebuildAcpTimeline(baseEntries).items.map(i => i.type)

    // Shuffle entries (different arrival order, same semantic content)
    const shuffled = [baseEntries[1], baseEntries[0], baseEntries[2]]
    const order2 = rebuildAcpTimeline(shuffled).items.map(i => i.type)

    expect(order1).toEqual(order2)
  })
})
