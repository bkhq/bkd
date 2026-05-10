import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { TimelineConverter, toTimeline } from './timeline-converter'
import type { NormalizedLogEntry, TimelineEntry } from './types'

// ────────────────────────────────────────────────────────────────────────────
// Invariants — properties that must hold for ANY input sequence.
//
// Unit tests assert "given X, output Y". These tests assert "given any X
// from a population, the output satisfies property P". They're cheap to
// write, broadly catch regressions, and don't presume a specific shape.
//
// Run on:
//   1. A real captured BKD session (turns 90-102, with SIGKILL mid-turn,
//      multi-tool batches, streaming chunks, follow-ups). Found at
//      test/fixtures/real-session-fixture.json. Replace it by running the
//      capture script in tools/ when needed.
//   2. Synthetic sequences crafted to stress specific invariants.
//
// If any of these fails, you've introduced a class of bug — not a single
// off-by-one. Time to read the converter again.
// ────────────────────────────────────────────────────────────────────────────

const FIXTURE_PATH = resolve(import.meta.dir, '../../test/fixtures/real-session-fixture.json')
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
  description: string
  entries: NormalizedLogEntry[]
}

/** Stream all entries one by one, collapsing multi-emit results to the latest snapshot per id. */
function streamAndCollect(entries: NormalizedLogEntry[]): TimelineEntry[] {
  const conv = new TimelineConverter()
  const byId = new Map<string, TimelineEntry>()
  for (const e of entries) {
    for (const out of conv.ingest('it', e)) byId.set(out.id, out)
  }
  for (const tail of conv.flush('it')) byId.set(tail.id, tail)
  return Array.from(byId.values()).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
}

// ─── Invariant 1: streaming and batch produce equivalent output ─────────────

describe('Invariant: streaming === batch (live SSE refresh and HTTP /logs agree)', () => {
  it('holds on the real captured BKD session', () => {
    const stream = streamAndCollect(fixture.entries)
    const batch = toTimeline(fixture.entries)

    expect(stream.length).toBe(batch.length)
    // Compare structural rendering fields. Sequence numbers may differ within
    // a single millisecond between paths because subSeq tiebreaker counts
    // ingest calls; the order of those calls can vary if wire delivery
    // doesn't perfectly match (turnIndex, timestamp) sort. What matters for
    // rendering is that BOTH sequences are monotonic per path (asserted
    // separately) and that ids/content match.
    for (let i = 0; i < stream.length; i++) {
      expect(stream[i].id).toBe(batch[i].id)
      expect(stream[i].type).toBe(batch[i].type)
      expect(stream[i].entryType).toBe(batch[i].entryType)
      expect(stream[i].content).toBe(batch[i].content)
      expect(stream[i].turnIndex).toBe(batch[i].turnIndex)
    }
  })

  it('preserves tool action/result toolCallId pairing regardless of wire arrival order', () => {
    // The realistic concern: a tool result's wire order can lead its action by
    // milliseconds (race in stdout demux). The converter must still produce
    // BOTH entries with matching toolCallId so the frontend can pair them.
    const reordered: NormalizedLogEntry[] = []
    const buf = new Map<string, NormalizedLogEntry>()
    for (const e of fixture.entries) {
      if (e.entryType === 'tool-use' && e.metadata?.toolCallId) {
        const cid = String(e.metadata.toolCallId)
        // Pair up: when we see the result, emit result then action (reversed).
        if (e.metadata?.isResult && buf.has(cid)) {
          reordered.push(e) // result first
          reordered.push(buf.get(cid)!) // action second
          buf.delete(cid)
          continue
        }
        if (!e.metadata?.isResult) {
          buf.set(cid, e)
          continue
        }
      }
      // Flush any unpaired actions — they happen before the next non-tool
      for (const pending of buf.values()) reordered.push(pending)
      buf.clear()
      reordered.push(e)
    }
    for (const pending of buf.values()) reordered.push(pending)

    const out = toTimeline(reordered)
    const tools = out.filter(e => e.type === 'tool')
    const actions = new Map<string, TimelineEntry>()
    const results = new Map<string, TimelineEntry>()
    for (const t of tools) {
      const cid = t.metadata?.toolCallId as string | undefined
      if (!cid) continue
      if (t.metadata?.isResult) results.set(cid, t)
      else actions.set(cid, t)
    }
    // Every result has a corresponding action regardless of wire order.
    for (const cid of results.keys()) {
      expect(actions.has(cid)).toBe(true)
    }
  })
})

// ─── Invariant 2: streaming flag terminal state ─────────────────────────────

describe('Invariant: every closed entry has streaming !== true', () => {
  it('holds on the real captured BKD session — no orphan streaming=true', () => {
    // The screenshot bug: turn 98 thinking left streaming=true after engine
    // SIGKILL. Then any later turn running rendered it as a live block.
    // After my fix (closing: true on every buffer-close path), no entry
    // should ever leave the converter with streaming=true unless it's the
    // CURRENT in-flight buffer at the moment of observation.
    //
    // Our fixture captures completed turns + an in-flight one (102 maybe).
    // After flush, NOTHING should be streaming.
    const conv = new TimelineConverter()
    const byId = new Map<string, TimelineEntry>()
    for (const e of fixture.entries) {
      for (const out of conv.ingest('it', e)) byId.set(out.id, out)
    }
    // CRITICAL: flush before assertion — this simulates settle/turn-end.
    for (const tail of conv.flush('it')) byId.set(tail.id, tail)

    const offenders = Array.from(byId.values()).filter(
      e => e.metadata?.streaming === true,
    )
    expect(offenders).toEqual([])
  })

  it('forces streaming=false when a thinking buffer is closed by a tool', () => {
    const conv = new TimelineConverter()
    const out: TimelineEntry[] = []
    out.push(...conv.ingest('it', {
      entryType: 'thinking',
      content: 'partial thinking',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:00Z',
      metadata: { streaming: true },
    }))
    // Tool entry interrupts thinking → buffer closes with streaming=false.
    // The converter emits multiple snapshots over the buffer's life; the
    // CLOSING emit (last one for that id) must carry streaming=false so the
    // client's upsert produces the final state.
    out.push(...conv.ingest('it', {
      entryType: 'tool-use',
      content: 'bash',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:01Z',
      messageId: 't1',
      metadata: { toolCallId: 't1' },
    }))
    const thinkings = out.filter(e => e.type === 'thinking')
    // Last emit per id wins on the client (upsert by id), so check the last.
    const lastThinking = thinkings.at(-1)
    expect(lastThinking).toBeDefined()
    expect(lastThinking!.metadata?.streaming).toBe(false)
  })

  it('forces streaming=false when a thinking buffer is closed by an assistant', () => {
    const conv = new TimelineConverter()
    const out: TimelineEntry[] = []
    out.push(...conv.ingest('it', {
      entryType: 'thinking',
      content: 'partial',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:00Z',
      metadata: { streaming: true },
    }))
    out.push(...conv.ingest('it', {
      entryType: 'assistant-message',
      content: 'answer',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:01Z',
      metadata: { streaming: true },
    }))
    // The first thinking emit happens during ingest; the second snapshot of
    // the (now-closed) thinking has streaming=false. Find the closing emit.
    const closedThinkings = out.filter(e => e.type === 'thinking')
    // At least one closing emit should have streaming=false.
    expect(closedThinkings.some(e => e.metadata?.streaming === false)).toBe(true)
  })

  it('forces streaming=false at turn boundary', () => {
    const conv = new TimelineConverter()
    const out: TimelineEntry[] = []
    out.push(...conv.ingest('it', {
      entryType: 'thinking',
      content: 'turn 0 partial',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:00Z',
      metadata: { streaming: true },
    }))
    out.push(...conv.ingest('it', {
      entryType: 'user-message',
      content: 'next turn',
      turnIndex: 1,
      timestamp: '2026-01-01T00:00:01Z',
      messageId: 'u1',
    }))
    const turn0Thinkings = out.filter(e => e.turnIndex === 0 && e.type === 'thinking')
    // Last emit for the turn-0 thinking id wins; that closing emit must mark
    // streaming=false so a re-render after the new turn doesn't re-treat it
    // as a live block.
    expect(turn0Thinkings.at(-1)?.metadata?.streaming).toBe(false)
  })

  it('forces streaming=false on flush (settle path simulating SIGKILL recovery)', () => {
    const conv = new TimelineConverter()
    conv.ingest('it', {
      entryType: 'thinking',
      content: 'engine died here',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:00Z',
      metadata: { streaming: true },
    })
    // No further ingest — engine SIGKILLed. Settle calls flush.
    const tail = conv.flush('it')
    expect(tail.length).toBe(1)
    expect(tail[0].metadata?.streaming).toBe(false)
  })
})

// ─── Invariant 3: cross-restart sequence monotonicity ───────────────────────

describe('Invariant: sequence numbers monotonic across converter restart', () => {
  it('post-restart entries always sort after pre-restart entries (timestamp-based)', () => {
    // The "user message disappears after restart" bug: live converter started
    // at sequence 0 after restart, colliding with batch-converted history that
    // also used 0..N. Now sequence = ts*1000 + tiebreaker, so wall-clock time
    // is the only thing that matters.
    const conv1 = new TimelineConverter()
    const pre = conv1.ingest('x', {
      entryType: 'assistant-message',
      content: 'old',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:00Z',
    })
    conv1.flush('x')
    const preSeq = pre.at(-1).sequence!

    // Simulate restart: brand-new converter, fresh state.
    const conv2 = new TimelineConverter()
    const post = conv2.ingest('x', {
      entryType: 'user-message',
      content: 'new',
      turnIndex: 1,
      timestamp: '2026-01-01T00:00:05Z',
      messageId: 'u-new',
    })
    const postSeq = post.at(-1).sequence!

    // Post-restart entry must have larger sequence (later wall-clock time).
    expect(postSeq).toBeGreaterThan(preSeq)
  })

  it('batch and live agree on sequence for the same entry', () => {
    // Crucial for refresh-after-stream: when frontend refetches /logs (batch),
    // entries must keep their sequence so user's scroll position and rendering
    // order doesn't shift.
    const entry: NormalizedLogEntry = {
      entryType: 'thinking',
      content: 'a',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:00Z',
    }
    const liveConv = new TimelineConverter()
    const liveOut = liveConv.ingest('x', entry)
    liveConv.flush('x')
    const batchOut = toTimeline([entry])
    expect(liveOut[0].sequence).toBe(batchOut[0].sequence)
  })

  it('no two entries within an issue share the same sequence', () => {
    // Even within the same millisecond, the tiebreaker subSeq guarantees
    // unique sequence values per entry. Otherwise sort would be ambiguous
    // and rendering order would jitter.
    const conv = new TimelineConverter()
    const out: TimelineEntry[] = []
    // 10 entries with the SAME timestamp — pathological case.
    for (let i = 0; i < 10; i++) {
      out.push(...conv.ingest('x', {
        entryType: 'tool-use',
        content: `t${i}`,
        turnIndex: 0,
        timestamp: '2026-01-01T00:00:00Z',
        messageId: `m${i}`,
        metadata: { toolCallId: `m${i}` },
      }))
    }
    const seqs = out.map(e => e.sequence!)
    expect(new Set(seqs).size).toBe(seqs.length)
    // Strict monotonic.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
  })
})

// ─── Invariant 4: tool action ↔ result pairing on real data ────────────────

describe('Invariant: tool entries preserve toolCallId for client-side pairing', () => {
  it('every tool result on real data has a matching action', () => {
    const out = toTimeline(fixture.entries)
    const tools = out.filter(e => e.type === 'tool')
    const actions = new Map<string, TimelineEntry>()
    const results = new Map<string, TimelineEntry>()
    for (const t of tools) {
      const cid = t.metadata?.toolCallId as string | undefined
      if (!cid) continue
      if (t.metadata?.isResult) results.set(cid, t)
      else actions.set(cid, t)
    }
    const orphans = Array.from(results.keys()).filter(cid => !actions.has(cid))
    expect(orphans).toEqual([])
  })

  it('tool entries keep stable distinct ids on real data', () => {
    const out = toTimeline(fixture.entries)
    const tools = out.filter(e => e.type === 'tool')
    const ids = new Set(tools.map(t => t.id))
    expect(ids.size).toBe(tools.length)
  })
})

// ─── Invariant 5: messageId preserved on output ─────────────────────────────

describe('invariant: messageId is preserved on output (frontend dedup contract)', () => {
  // The bug class: optimistic frontend entries carry the raw messageId, but
  // canonical entries from the backend converter use id=`turn-N-{type}-{messageId}`.
  // Without the messageId field on the canonical entry, the frontend's
  // findExisting fallback (match by messageId when ids differ) can't fire,
  // and the user sees the same message twice — once with the optimistic
  // attachment URL and once with the canonical one. Screenshot caught this.
  it('every input entry with a messageId produces an output entry that carries it', () => {
    const inputs: NormalizedLogEntry[] = [
      {
        entryType: 'user-message',
        content: 'with image',
        turnIndex: 0,
        timestamp: '2026-01-01T00:00:00Z',
        messageId: 'msg_user_1',
        metadata: { attachments: [{ id: 'a1', name: 'image.png' }] },
      },
      {
        entryType: 'tool-use',
        content: 'bash',
        turnIndex: 0,
        timestamp: '2026-01-01T00:00:01Z',
        messageId: 'msg_tool_1',
        metadata: { toolCallId: 't1' },
      },
      {
        entryType: 'tool-use',
        content: 'output',
        turnIndex: 0,
        timestamp: '2026-01-01T00:00:02Z',
        messageId: 'msg_tool_1_r',
        metadata: { toolCallId: 't1', isResult: true },
      },
    ]
    const out = toTimeline(inputs)
    const userOut = out.find(e => e.type === 'user')
    expect(userOut?.messageId).toBe('msg_user_1')
    const toolActions = out.filter(e => e.type === 'tool' && !e.metadata?.isResult)
    expect(toolActions[0]?.messageId).toBe('msg_tool_1')
    const toolResults = out.filter(e => e.type === 'tool' && e.metadata?.isResult)
    expect(toolResults[0]?.messageId).toBe('msg_tool_1_r')
  })

  it('thinking/assistant buffers preserve messageId from the first chunk', () => {
    const conv = new TimelineConverter()
    const out: TimelineEntry[] = []
    out.push(...conv.ingest('it', {
      entryType: 'thinking',
      content: 'first',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:00Z',
      messageId: 'msg_think_1',
      metadata: { streaming: true },
    }))
    out.push(...conv.ingest('it', {
      entryType: 'thinking',
      content: 'first second',
      turnIndex: 0,
      timestamp: '2026-01-01T00:00:01Z',
      messageId: 'msg_think_1',
      metadata: { streaming: true },
    }))
    for (const e of out.filter(x => x.type === 'thinking')) {
      expect(e.messageId).toBe('msg_think_1')
    }
  })

  it('real-captured user entries all carry their messageId', () => {
    const out = toTimeline(fixture.entries)
    const inputUsersWithMid = fixture.entries.filter(
      e => e.entryType === 'user-message' && e.messageId,
    )
    const outputUsers = out.filter(e => e.type === 'user')
    for (const src of inputUsersWithMid) {
      const match = outputUsers.find(o => o.messageId === src.messageId)
      expect(match).toBeDefined()
    }
  })
})

// ─── Invariant 6: real-data structural sanity ───────────────────────────────

describe('invariant: real-data shape integrity', () => {
  it('every entry has a non-empty id, type, and sequence', () => {
    const out = toTimeline(fixture.entries)
    for (const e of out) {
      expect(e.id).toBeTruthy()
      expect(e.type).toBeTruthy()
      expect(typeof e.sequence).toBe('number')
    }
  })

  it('thinking and assistant ids are unique per (turn, segment)', () => {
    // After my fix to split segments on tool/turn boundaries, no two thinking
    // entries should ever share an id within a single conversion.
    const out = toTimeline(fixture.entries)
    const thinking = out.filter(e => e.type === 'thinking')
    const ids = new Set(thinking.map(e => e.id))
    expect(ids.size).toBe(thinking.length)
    const assistant = out.filter(e => e.type === 'assistant')
    const aIds = new Set(assistant.map(e => e.id))
    expect(aIds.size).toBe(assistant.length)
  })

  it('order within each turn matches insertion order', () => {
    const out = toTimeline(fixture.entries)
    const seqs = out.map(e => e.sequence!)
    // Sequences must be strictly monotonic — if not, frontend sort would
    // reorder entries on every render.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
    }
  })
})
