import { describe, expect, it } from 'bun:test'
import { TimelineConverter, toTimeline } from './timeline-converter'
import type { NormalizedLogEntry, TimelineEntry } from './types'

/**
 * Drive the live streaming path entry-by-entry, then flush, and collapse
 * multi-emit results to the latest snapshot per id (matches what the client
 * sees after applying SSE upserts in order).
 */
function streamAndCollect(entries: NormalizedLogEntry[]): TimelineEntry[] {
  const conv = new TimelineConverter()
  const byId = new Map<string, TimelineEntry>()
  for (const e of entries) {
    for (const out of conv.ingest('it', e)) byId.set(out.id, out)
  }
  for (const tail of conv.flush('it')) byId.set(tail.id, tail)
  return Array.from(byId.values()).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
}

describe('toTimeline', () => {
  it('merges consecutive thinking chunks within a segment', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'Let', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: ' me', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: ' check', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { streaming: true } },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('thinking')
    expect(result[0].content).toBe('Let me check')
  })

  it('splits thinking into segments when interrupted by tool calls', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'First thought', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'tool-use', content: 'Read file', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { toolCallId: 't1' } },
      { entryType: 'thinking', content: 'After tool', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z' },
      { entryType: 'assistant-message', content: 'Answer', turnIndex: 0, timestamp: '2026-01-01T00:00:03Z' },
    ]

    const result = toTimeline(entries)
    // Sorted by timestamp: thinking(00) → tool(01) → thinking(02) → assistant(03)
    expect(result).toHaveLength(4)
    expect(result[0].type).toBe('thinking')
    expect(result[0].content).toBe('First thought')
    expect(result[1].type).toBe('tool')
    expect(result[2].type).toBe('thinking')
    expect(result[2].content).toBe('After tool')
    expect(result[3].type).toBe('assistant')
  })

  it('accumulates assistant chunks', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Hel', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'assistant-message', content: 'Hello', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } },
      { entryType: 'assistant-message', content: 'Hello world', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { streaming: true } },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'turn-0-assistant-0000',
      turnIndex: 0,
      type: 'assistant',
      content: 'Hello world',
    })
  })

  it('drops empty thinking chunks', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: '', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'thinking', content: '   ', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
      { entryType: 'assistant-message', content: 'Hello', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z' },
    ]

    const result = toTimeline(entries)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('assistant')
    expect(result[0].content).toBe('Hello')
  })

  it('handles full-content replacement for assistant', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Hello', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'assistant-message', content: 'Hello world', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } },
    ]

    const result = toTimeline(entries)
    expect(result[0].content).toBe('Hello world')
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
      { entryType: 'assistant-message', content: '', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('')
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

  it('prefers longer text when new is shorter than old for assistant', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Longer text here', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'assistant-message', content: 'Longer', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('Longer text here')
  })

  it('concatenates unrelated assistant chunks as fallback', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'First part', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'assistant-message', content: 'Second part', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
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
    expect(result[0].metadata.toolCallId).toBe('t1')
    expect(result[1].metadata.toolCallId).toBe('t2')
    expect(result[2].metadata.toolCallId).toBe('t1')
  })

  it('marks streaming false when any assistant entry has streaming=false', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Hello', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'assistant-message', content: 'Hello world', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: false } },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].metadata.streaming).toBe(false)
  })

  it('creates multiple thinking segments when interrupted by multiple tools', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'A', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'tool-use', content: 'Tool1', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
      { entryType: 'thinking', content: 'B', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z' },
      { entryType: 'tool-use', content: 'Tool2', turnIndex: 0, timestamp: '2026-01-01T00:00:03Z' },
      { entryType: 'thinking', content: 'C', turnIndex: 0, timestamp: '2026-01-01T00:00:04Z' },
      { entryType: 'assistant-message', content: 'Done', turnIndex: 0, timestamp: '2026-01-01T00:00:05Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(6)
    expect(result[0].type).toBe('thinking')
    expect(result[0].content).toBe('A')
    expect(result[1].type).toBe('tool')
    expect(result[2].type).toBe('thinking')
    expect(result[2].content).toBe('B')
    expect(result[3].type).toBe('tool')
    expect(result[4].type).toBe('thinking')
    expect(result[4].content).toBe('C')
    expect(result[5].type).toBe('assistant')
  })

  it('flushes assistant buffer when turn changes', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Turn 0', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'assistant-message', content: 'Turn 1', turnIndex: 1, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Turn 0')
    expect(result[0].turnIndex).toBe(0)
    expect(result[1].content).toBe('Turn 1')
    expect(result[1].turnIndex).toBe(1)
  })

  it('flushes thinking buffer when turn changes', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'thinking', content: 'Turn 0 thinking', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'thinking', content: 'Turn 1 thinking', turnIndex: 1, timestamp: '2026-01-01T00:00:01Z' },
    ]

    const result = toTimeline(entries)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Turn 0 thinking')
    expect(result[0].turnIndex).toBe(0)
    expect(result[1].content).toBe('Turn 1 thinking')
    expect(result[1].turnIndex).toBe(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Streaming vs batch equivalence — the core invariant.
//
// These tests pin down "live SSE accumulation" produces the same final state
// as "refresh-via-/logs batch reconstruction". Before the converter unification,
// `toTimelineEntry` (single-emit) and `toTimeline` (batch) had divergent rules,
// causing the "刷新就好" class of bugs. Any new behavior must keep both paths
// in lockstep — these tests are the canary.
// ────────────────────────────────────────────────────────────────────────────

describe('streaming vs batch equivalence', () => {
  function expectEquivalent(entries: NormalizedLogEntry[]) {
    const stream = streamAndCollect(entries)
    const batch = toTimeline(entries)

    expect(stream.length).toBe(batch.length)
    for (let i = 0; i < stream.length; i++) {
      // Compare structural fields — sequence and timestamps are noisy under
      // wall-clock fallback, but id, type, content, turnIndex must align.
      expect(stream[i].id).toBe(batch[i].id)
      expect(stream[i].type).toBe(batch[i].type)
      expect(stream[i].entryType).toBe(batch[i].entryType)
      expect(stream[i].content).toBe(batch[i].content)
      expect(stream[i].turnIndex).toBe(batch[i].turnIndex)
    }
  }

  it('produces identical output for cumulative thinking stream', () => {
    expectEquivalent([
      { entryType: 'thinking', content: 'Let', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: 'Let me', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: 'Let me check', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { streaming: false } },
    ])
  })

  it('produces identical output for delta-style thinking stream', () => {
    expectEquivalent([
      { entryType: 'thinking', content: 'Let', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: ' me', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } },
      { entryType: 'thinking', content: ' check', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { streaming: false } },
    ])
  })

  it('produces identical output for thinking → tool → thinking → assistant', () => {
    expectEquivalent([
      { entryType: 'thinking', content: 'First thought', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'tool-use', content: 'Read', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', messageId: 't1', metadata: { toolCallId: 't1' } },
      { entryType: 'thinking', content: 'After tool', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z' },
      { entryType: 'assistant-message', content: 'Answer', turnIndex: 0, timestamp: '2026-01-01T00:00:03Z' },
    ])
  })

  it('produces identical output for repeated thinking-tool-thinking-tool pattern', () => {
    // The screenshot's "挤一团" case: multiple thinking segments interleaved
    // with tools must split into distinct entries with distinct ids.
    expectEquivalent([
      { entryType: 'thinking', content: 'A', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'tool-use', content: 'Tool1', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', messageId: 't1' },
      { entryType: 'thinking', content: 'B', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z' },
      { entryType: 'tool-use', content: 'Tool2', turnIndex: 0, timestamp: '2026-01-01T00:00:03Z', messageId: 't2' },
      { entryType: 'thinking', content: 'C', turnIndex: 0, timestamp: '2026-01-01T00:00:04Z' },
      { entryType: 'assistant-message', content: 'Done', turnIndex: 0, timestamp: '2026-01-01T00:00:05Z' },
    ])
  })

  it('produces identical output across turn boundaries', () => {
    expectEquivalent([
      { entryType: 'thinking', content: 'T0a', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'assistant-message', content: 'T0', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
      { entryType: 'user-message', content: 'follow-up', turnIndex: 1, timestamp: '2026-01-01T00:00:02Z', messageId: 'u1' },
      { entryType: 'thinking', content: 'T1a', turnIndex: 1, timestamp: '2026-01-01T00:00:03Z' },
      { entryType: 'assistant-message', content: 'T1', turnIndex: 1, timestamp: '2026-01-01T00:00:04Z' },
    ])
  })

  it('produces identical output when assistant follows thinking in same segment', () => {
    expectEquivalent([
      { entryType: 'thinking', content: 'Hmm', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' },
      { entryType: 'assistant-message', content: 'Wait', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' },
      { entryType: 'thinking', content: 'Actually', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z' },
      { entryType: 'assistant-message', content: 'Better', turnIndex: 0, timestamp: '2026-01-01T00:00:03Z' },
    ])
  })

  it('produces identical output when tool action and result interleave', () => {
    expectEquivalent([
      { entryType: 'tool-use', content: 'Bash', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', messageId: 'a1', metadata: { toolCallId: 't1', toolName: 'Bash' }, toolDetail: { kind: 'command-run', toolName: 'Bash', toolCallId: 't1', isResult: false } },
      { entryType: 'tool-use', content: 'output', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', messageId: 'r1', metadata: { toolCallId: 't1', isResult: true }, toolDetail: { kind: 'command-run', toolName: 'Bash', toolCallId: 't1', isResult: true } },
      { entryType: 'tool-use', content: 'Read', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', messageId: 'a2', metadata: { toolCallId: 't2', toolName: 'Read' }, toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't2', isResult: false } },
      { entryType: 'tool-use', content: 'file', turnIndex: 0, timestamp: '2026-01-01T00:00:03Z', messageId: 'r2', metadata: { toolCallId: 't2', isResult: true }, toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't2', isResult: true } },
    ])
  })
})

describe('TimelineConverter — sequence and segment ids', () => {
  it('assigns monotonically increasing sequence numbers per issue', () => {
    const conv = new TimelineConverter()
    const out: TimelineEntry[] = []
    for (let i = 0; i < 5; i++) {
      out.push(...conv.ingest('a', {
        entryType: 'thinking',
        content: `t${i}`,
        turnIndex: i,
        timestamp: `2026-01-01T00:00:0${i}Z`,
      }))
    }
    out.push(...conv.flush('a'))
    const seqs = out.map(e => e.sequence ?? -1)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThanOrEqual(seqs[i - 1])
    }
  })

  it('isolates state per issueId (no cross-talk)', () => {
    const conv = new TimelineConverter()
    const a = conv.ingest('A', { entryType: 'thinking', content: 'A1', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' })
    const b = conv.ingest('B', { entryType: 'thinking', content: 'B1', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' })
    expect(a[0].id).toBe('turn-0-thinking-0000')
    expect(b[0].id).toBe('turn-0-thinking-0000')
    expect(a[0].content).toBe('A1')
    expect(b[0].content).toBe('B1')
  })

  it('reset() clears state for an issue', () => {
    const conv = new TimelineConverter()
    conv.ingest('x', { entryType: 'thinking', content: 'old', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' })
    conv.reset('x')
    const out = conv.ingest('x', { entryType: 'thinking', content: 'new', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' })
    // Fresh state — first thinking in turn 0 carries the zero-padded suffix.
    expect(out[0].id).toBe('turn-0-thinking-0000')
    expect(out[0].content).toBe('new')
    // Sequence is anchored to entry timestamp (ms-since-epoch * 1000) and is
    // strictly greater than the previous lastSeq. On a fresh-reset issue the
    // first entry's lastSeq is 0, so sequence = max(ts * 1000, 1) — for any
    // realistic timestamp this is just ts * 1000 exactly.
    expect(out[0].sequence).toBe(new Date('2026-01-01T00:00:00Z').getTime() * 1000)
  })

  it('multi-segment thinking gets distinct ids within a turn', () => {
    const conv = new TimelineConverter()
    const all: TimelineEntry[] = []
    all.push(...conv.ingest('z', { entryType: 'thinking', content: 'A', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' }))
    all.push(...conv.ingest('z', { entryType: 'tool-use', content: 'T1', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', messageId: 't1' }))
    all.push(...conv.ingest('z', { entryType: 'thinking', content: 'B', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z' }))
    all.push(...conv.flush('z'))

    const thinkings = all.filter(e => e.type === 'thinking')
    const ids = new Set(thinkings.map(e => e.id))
    // Two distinct thinking segments → two distinct ids
    expect(ids.size).toBeGreaterThanOrEqual(2)
    expect(ids.has('turn-0-thinking-0000')).toBe(true)
    expect(ids.has('turn-0-thinking-0001')).toBe(true)
  })

  // ── Regression: identical-content guard ──
  // When an engine re-emits the same cumulative chunk without new text,
  // mergeChunk must NOT double the content. Before the fix, the `else`
  // branch blindly did `buffer.content += text`, producing duplicates.
  // These tests verify both the live streaming path (streamAndCollect)
  // and the batch /logs path (toTimeline).

  it('does not double content when identical assistant chunk re-emitted', () => {
    const entries: NormalizedLogEntry[] = [
      { entryType: 'assistant-message', content: 'Hello', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } },
      { entryType: 'assistant-message', content: 'Hello', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } },
      { entryType: 'assistant-message', content: 'Hello world', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { streaming: true } },
    ]
    const result = toTimeline(entries)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('Hello world')
    // Not doubled: "HelloHelloHello world" or similar
  })

  it('does not double content when identical thinking chunk re-emitted (live path)', () => {
    const conv = new TimelineConverter()
    const all: TimelineEntry[] = []
    all.push(...conv.ingest('x', { entryType: 'thinking', content: 'X', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } }))
    all.push(...conv.ingest('x', { entryType: 'thinking', content: 'X', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } }))
    all.push(...conv.ingest('x', { entryType: 'thinking', content: 'XY', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { streaming: true } }))
    all.push(...conv.flush('x'))
    const lastSnapshot = all.filter(e => e.id === 'turn-0-thinking-0000').at(-1)
    expect(lastSnapshot?.content).toBe('XY')
  })

  it('does not double content when identical assistant chunk re-emitted (live path)', () => {
    const conv = new TimelineConverter()
    const all: TimelineEntry[] = []
    all.push(...conv.ingest('y', { entryType: 'assistant-message', content: 'A', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } }))
    all.push(...conv.ingest('y', { entryType: 'assistant-message', content: 'A', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } }))
    all.push(...conv.ingest('y', { entryType: 'assistant-message', content: 'AB', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', metadata: { streaming: true } }))
    all.push(...conv.flush('y'))
    const lastSnapshot = all.filter(e => e.id === 'turn-0-assistant-0000').at(-1)
    expect(lastSnapshot?.content).toBe('AB')
  })

  it('does not splice different responses when assistant chunks interleave', () => {
    // Simulates: assistant says "Alpha" → thinking → tool → assistant says "Beta"
    // Each gets its own buffer (different ids), no concatenation.
    const conv = new TimelineConverter()
    const byId = new Map<string, TimelineEntry>()

    // Assistant "Alpha"
    for (const e of conv.ingest('z', { entryType: 'assistant-message', content: 'Alpha', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z', metadata: { streaming: true } })) byId.set(e.id, e)
    // Thinking flushes assistant
    for (const e of conv.ingest('z', { entryType: 'thinking', content: 'Think', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z', metadata: { streaming: true } })) byId.set(e.id, e)
    // Tool flushes thinking
    for (const e of conv.ingest('z', { entryType: 'tool-use', content: 'Tool', turnIndex: 0, timestamp: '2026-01-01T00:00:02Z', messageId: 't1' })) byId.set(e.id, e)
    // New assistant segment — must NOT merge into old
    for (const e of conv.ingest('z', { entryType: 'assistant-message', content: 'Beta', turnIndex: 0, timestamp: '2026-01-01T00:00:03Z', metadata: { streaming: true } })) byId.set(e.id, e)
    for (const e of conv.flush('z')) byId.set(e.id, e)

    const assistants = Array.from(byId.values()).filter(e => e.type === 'assistant').sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    expect(assistants).toHaveLength(2)
    expect(assistants[0].id).toBe('turn-0-assistant-0000')
    expect(assistants[0].content).toBe('Alpha')
    expect(assistants[1].id).toBe('turn-0-assistant-0001')
    expect(assistants[1].content).toBe('Beta')
  })

  it('flush() emits final snapshots and clears in-flight buffers', () => {
    const conv = new TimelineConverter()
    conv.ingest('q', { entryType: 'thinking', content: 'partial', turnIndex: 0, timestamp: '2026-01-01T00:00:00Z' })
    const tail = conv.flush('q')
    expect(tail.length).toBe(1)
    expect(tail[0].type).toBe('thinking')
    expect(tail[0].content).toBe('partial')
    // After flush, a follow-up thinking opens a fresh segment (no carry-over)
    const next = conv.ingest('q', { entryType: 'thinking', content: 'new', turnIndex: 0, timestamp: '2026-01-01T00:00:01Z' })
    expect(next[0].id).toBe('turn-0-thinking-0001')
  })
})
