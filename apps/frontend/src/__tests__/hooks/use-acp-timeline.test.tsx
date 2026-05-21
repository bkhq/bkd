import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { useAcpTimeline } from '@/hooks/use-acp-timeline'
import type { NormalizedLogEntry, TimelineEntry } from '@/types/kanban'

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

/**
 * Test helper that mimics what the backend `TimelineConverter` produces:
 *   - sort by timestamp (chronological)
 *   - assign monotonic `sequence`
 *   - segment-aware ids for thinking/assistant when interrupted by tools
 *
 * Frontend `useAcpTimeline` is a pure mapping over already-converted
 * TimelineEntry — these tests must feed it post-conversion data.
 */
function toTimeline(entries: NormalizedLogEntry[]): TimelineEntry[] {
  const typeMap: Record<string, TimelineEntry['type']> = {
    'thinking': 'thinking',
    'assistant-message': 'assistant',
    'tool-use': 'tool',
    'system-message': 'system',
    'error-message': 'error',
    'user-message': 'user',
  }
  const sorted = [...entries].sort((a, b) => {
    const ta = a.turnIndex ?? 0
    const tb = b.turnIndex ?? 0
    if (ta !== tb) return ta - tb
    const tsa = a.timestamp ? new Date(a.timestamp).getTime() : 0
    const tsb = b.timestamp ? new Date(b.timestamp).getTime() : 0
    return tsa - tsb
  })
  // Track segment counters so multi-segment thinking/assistant get distinct ids
  const segCount: Record<string, Record<string, number>> = {}
  const lastNonStreaming: Record<number, string | null> = {}
  return sorted.map((entry, idx) => {
    const type = typeMap[entry.entryType] ?? 'system'
    const turn = entry.turnIndex ?? 0
    let id: string
    if (type === 'thinking' || type === 'assistant') {
      const turnSeg = segCount[turn] ?? (segCount[turn] = {})
      // If the previous entry within this turn was a different streaming type
      // (or a tool/non-streaming), bump segment count.
      const last = lastNonStreaming[turn]
      if (last && last !== type) turnSeg[type] = (turnSeg[type] ?? -1) + 1
      const segIdx = turnSeg[type] ?? 0
      turnSeg[type] = segIdx
      id = segIdx === 0 ? `turn-${turn}-${type}` : `turn-${turn}-${type}-${segIdx}`
      lastNonStreaming[turn] = type
    } else {
      id = entry.messageId ?? `turn-${turn}-${type}-${idx}`
      lastNonStreaming[turn] = type === 'tool' ? 'tool' : type
    }
    return {
      ...entry,
      id,
      type,
      sequence: idx,
    }
  })
}

function rebuildAcpTimeline(logs: NormalizedLogEntry[]) {
  const { result } = renderHook(() => useAcpTimeline(toTimeline(logs)), { wrapper: createWrapper() })
  return result.current
}

describe('useAcpTimeline rendering', () => {
  it('deduplicates adjacent thinking when assistant repeats the same prefix', () => {
    // When OpenCode streams thinking and then sends an assistant message that
    // starts with the exact same text, the thinking block is redundant — the
    // user sees the same content twice. Remove the standalone thinking entry
    // so only the assistant message (with its richer formatting) remains.
    // This only applies when thinking and assistant are adjacent; thinking
    // blocks separated by tool calls are preserved.
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
        content: '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer，没测前端 state 的去重',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // Only the assistant message remains — thinking deduplicated.
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe('entry')
    expect((items[0] as { entry: NormalizedLogEntry }).entry.entryType).toBe('assistant-message')
  })

  it('keeps thinking across tool groups when assistant has different content', () => {
    // When the assistant does NOT repeat the thinking prefix, both should be
    // preserved — the thinking block shows the reasoning process, and the
    // assistant shows the final reply.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: 'Let me check the imports first',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
      {
        entryType: 'tool-use',
        content: 'Read src/app.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        messageId: 't1',
        metadata: { toolCallId: 't1', isResult: false },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: 'I found the issue in the type definitions',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: true },
      },
    ]

    const { items } = rebuildAcpTimeline(logs)

    // 3 items: thinking + tool-group + assistant — all preserved.
    expect(items).toHaveLength(3)
    expect(items[0]!.type).toBe('thinking')
    expect(items[1]!.type).toBe('tool-group')
    expect(items[2]!.type).toBe('entry')
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

  it('deduplicates thinking across tool groups when assistant repeats the same prefix', () => {
    // OpenCode often sends thinking → tool → assistant where the assistant
    // starts with the exact same text as the thinking. Without dedup, users
    // see the same content twice — once in the thinking block and again in
    // the assistant reply — which feels like "thinking and reply merged".
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
        messageId: 't1',
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

    // 2 items: tool-group + assistant — thinking deduplicated.
    expect(items).toHaveLength(2)
    expect(items[0]!.type).toBe('tool-group')
    expect(items[1]!.type).toBe('entry')
    const assistantItem = items[1] as { entry: NormalizedLogEntry }
    expect(assistantItem.entry.entryType).toBe('assistant-message')
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
    // Backend TimelineConverter already merges cascading chunks.
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'B里还留着历史销售记录，月份的报表还能看到这个"派对套餐"',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
        metadata: { streaming: false, completed: true },
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
    // Backend assigns sequence based on chronological ingest order, and
    // useIssueStream sorts by sequence. The test helper here mimics that
    // by sorting on timestamp, so any input ordering of the same entries
    // produces the same output.
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
        messageId: 't1',
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
