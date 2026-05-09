import { describe, expect, it } from 'bun:test'
import { toTimeline } from './timeline-converter'
import type { NormalizedLogEntry } from './types'

describe('toTimeline', () => {
  it('accumulates thinking chunks per turn', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'Let', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: ' me', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: ' check', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { streaming: true } },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'turn-0-thinking',
      turnIndex: 0,
      type: 'thinking',
      content: 'Let me check',
    })
  })

  it('handles full-content replacement (superset)', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'Let me check', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: 'Let me check the imports', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } },
    ]

    const result = toTimeline(entries)
    expect(result[0].content).toBe('Let me check the imports')
  })

  it('deduplicates overlapping thinking', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'First thought', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'thinking', content: 'Second thought', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('First thoughtSecond thought')
  })

  it('filters noise entries', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'system-message', content: 'version', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'thinking', content: 'Real thinking here', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('thinking')
  })

  it('orders thinking before assistant in same turn', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Answer', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
      { entryType: 'thinking', content: 'Let me think', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('thinking')
    expect(result[1].type).toBe('assistant')
  })

  it('handles multiple turns', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'Turn 0', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'thinking', content: 'Turn 1', turnIndex: 1, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(2)
    expect(result[0].turnIndex).toBe(0)
    expect(result[1].turnIndex).toBe(1)
  })

  it('preserves tool-use entries without accumulation', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'tool-use', content: 'Tool: Bash', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { toolCallId: 'tc-1' } },
      { entryType: 'tool-use', content: 'output', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { toolCallId: 'tc-1', isResult: true } },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('tool')
    expect(result[1].type).toBe('tool')
  })

  it('handles empty content without crashing', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: '', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'assistant-message', content: '', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('')
    expect(result[1].content).toBe('')
  })

  it('accumulates assistant per turn, not globally', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Turn 0 reply', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'assistant-message', content: 'Turn 1 reply', turnIndex: 1, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Turn 0 reply')
    expect(result[1].content).toBe('Turn 1 reply')
  })

  it('prefers longer text when new is shorter than old', () => {
    // Regression: some engines may send a shorter text after a longer one
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'Longer text here', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'thinking', content: 'Longer', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('Longer text here')
  })

  it('concatenates unrelated chunks as fallback', () => {
    // When neither text is a prefix of the other, concatenate
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'First part', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'thinking', content: 'Second part', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('First partSecond part')
  })

  it('preserves multiple tool calls with different ids', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'tool-use', content: 'Read file', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { toolCallId: 't1' }, toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false } },
      { entryType: 'tool-use', content: 'Bash cmd', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { toolCallId: 't2' }, toolDetail: { kind: 'bash', toolName: 'Bash', toolCallId: 't2', isResult: false } },
      { entryType: 'tool-use', content: 'file content', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { toolCallId: 't1', isResult: true }, toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: true } },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(3)
    // Tool entries should NOT be accumulated — each kept separate
    expect(result[0].metadata.toolCallId).toBe('t1')
    expect(result[1].metadata.toolCallId).toBe('t2')
    expect(result[2].metadata.toolCallId).toBe('t1')
  })

  it('marks streaming false when any entry has streaming=false', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Hello', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'assistant-message', content: 'Hello world', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: false } },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].metadata.streaming).toBe(false)
  })
})
