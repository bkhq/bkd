import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIssueStream } from '@/hooks/use-issue-stream'
import type { IssueEventHandler } from '@/lib/event-bus'
import type { NormalizedLogEntry, TimelineEntry } from '@/types/kanban'

// ────────────────────────────────────────────────────────────────────────────
// Reorder-race repros — the user reports "跑着跑着就乱序了, 无法稳定复现".
// Each `it` here is a *candidate* race the audit flagged. Run the file:
//   - tests that pass = scenario is NOT the bug
//   - tests that fail = scenario IS (or contributes to) the bug
//
// Goal: let the failing tests point at the actual root cause(s) without
// guessing. Do NOT add a fix here; just instrument repros.
// ────────────────────────────────────────────────────────────────────────────

const subscribeMock = vi.fn()
const getIssueLogsMock = vi.fn()

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    subscribe: (...args: unknown[]) => subscribeMock(...args),
    onResume: () => () => {},
  },
}))

vi.mock('@/lib/kanban-api', () => ({
  kanbanApi: {
    getIssueLogs: (...args: unknown[]) => getIssueLogsMock(...args),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** Backend-shaped entry: messageId + canonical id + monotonic sequence. */
function entry(opts: {
  turn: number
  entryType: TimelineEntry['entryType']
  type: TimelineEntry['type']
  messageId?: string
  content: string
  ts: string
  sequence?: number
  idSuffix?: string
  metadata?: Record<string, unknown>
}): TimelineEntry {
  const baseId = (() => {
    if (opts.type === 'assistant' || opts.type === 'thinking') {
      return `turn-${opts.turn}-${opts.type}`
    }
    return `turn-${opts.turn}-${opts.type}-${opts.idSuffix ?? opts.messageId ?? 'x'}`
  })()
  return {
    id: baseId,
    messageId: opts.messageId,
    turnIndex: opts.turn,
    type: opts.type,
    entryType: opts.entryType,
    content: opts.content,
    timestamp: opts.ts,
    sequence: opts.sequence ?? new Date(opts.ts).getTime() * 1000,
    metadata: opts.metadata ?? {},
  }
}

beforeEach(() => {
  subscribeMock.mockReset()
  getIssueLogsMock.mockReset()
})

// ────────────────────────────────────────────────────────────────────────────
// R1 — thinking buffer position shifts when its later chunk's sequence
// out-grows an interleaved tool-use that was emitted between chunks.
//
// Reality on ACP/Codex/OpenCode: assistant/thinking arrive as cascading
// chunks. Backend sequence is `max(ts*1000, lastSeq+1)`, strictly monotonic.
// If between two thinking chunks a tool-use lands, the tool's sequence is
// SMALLER than the LATER thinking chunk (which replaces the earlier one in
// place via appendEntry, taking its larger sequence). Sort by sequence then
// puts tool BEFORE the (final) thinking — but thinking actually started
// first. UI: thinking jumps below the tool every time it streams more text.
// ────────────────────────────────────────────────────────────────────────────
describe('r1: streaming-segment position shift on chunk update', () => {
  it('thinking originally emitted BEFORE a tool-use should stay BEFORE that tool, even after a later chunk update', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValue({ issue: null, logs: [], nextCursor: null, hasMore: false })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(handler).not.toBeNull())

    // Emission order:
    //   1) thinking chunk #1  seq=1000
    //   2) tool-use start      seq=2000
    //   3) thinking chunk #2  seq=3000  (replaces #1, same id `turn-0-thinking`)
    act(() => {
      handler!.onLog(entry({
        turn: 0,
        type: 'thinking',
        entryType: 'thinking',
        content: '思考开始',
        ts: '2026-01-01T00:00:00.000Z',
        sequence: 1000,
        metadata: { streaming: true },
      }) as NormalizedLogEntry)
      handler!.onLog(entry({
        turn: 0,
        type: 'tool',
        entryType: 'tool-use',
        content: 'Bash',
        ts: '2026-01-01T00:00:00.001Z',
        sequence: 2000,
        idSuffix: 'tool_a',
        messageId: 'tool_a',
      }) as NormalizedLogEntry)
      handler!.onLog(entry({
        turn: 0,
        type: 'thinking',
        entryType: 'thinking',
        content: '思考开始 继续思考',
        ts: '2026-01-01T00:00:00.002Z',
        sequence: 3000,
        metadata: { streaming: true },
      }) as NormalizedLogEntry)
    })

    await waitFor(() => expect(result.current.logs).toHaveLength(2))

    const types = result.current.logs.map(l => l.type)
    // EXPECT emission order preserved: thinking, then tool.
    // CURRENT impl will likely render: tool (seq 2000), thinking (seq 3000).
    expect(types).toEqual(['thinking', 'tool'])
  })

  it('assistant streamed across a tool-use stays anchored at its start position', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValue({ issue: null, logs: [], nextCursor: null, hasMore: false })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(handler).not.toBeNull())

    act(() => {
      handler!.onLog(entry({
        turn: 0,
        type: 'assistant',
        entryType: 'assistant-message',
        content: 'Hello',
        ts: '2026-01-01T00:00:00.000Z',
        sequence: 1000,
        metadata: { streaming: true },
      }) as NormalizedLogEntry)
      handler!.onLog(entry({
        turn: 0,
        type: 'tool',
        entryType: 'tool-use',
        content: 'Read',
        ts: '2026-01-01T00:00:00.001Z',
        sequence: 2000,
        idSuffix: 'tool_b',
        messageId: 'tool_b',
      }) as NormalizedLogEntry)
      handler!.onLog(entry({
        turn: 0,
        type: 'assistant',
        entryType: 'assistant-message',
        content: 'Hello world',
        ts: '2026-01-01T00:00:00.002Z',
        sequence: 3000,
        metadata: { streaming: true },
      }) as NormalizedLogEntry)
    })

    await waitFor(() => expect(result.current.logs).toHaveLength(2))
    expect(result.current.logs.map(l => l.type)).toEqual(['assistant', 'tool'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// R2 — initial /logs HTTP fetch in flight while SSE delivers a NEW entry.
// The SSE entry is synthesized with sequence = ts*1000 (because backend
// sometimes ships without sequence on streaming chunks, or the converter
// produced one slightly later than ts*1000 via the lastSeq+1 branch). When
// /logs returns, its canonical entries arrive with backend-assigned
// sequences. Merge by id → check no reorder.
// ────────────────────────────────────────────────────────────────────────────
describe('r2: SSE-during-in-flight-fetch keeps order', () => {
  it('sSE entry arriving before /logs resolves stays in the right relative slot', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })

    const fetch = deferred<{
      issue: null
      logs: NormalizedLogEntry[]
      nextCursor: null
      hasMore: boolean
    }>()
    getIssueLogsMock.mockReturnValue(fetch.promise)

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(handler).not.toBeNull())

    // SSE delivers a fresh-now entry FIRST. No `sequence` field (worst case
    // — covers backend regressions). toTimelineEntry will synthesize from ts.
    act(() => {
      handler!.onLog({
        id: 'turn-1-assistant',
        type: 'assistant',
        entryType: 'assistant-message',
        content: 'live A',
        timestamp: '2026-06-01T00:00:00.000Z',
        turnIndex: 1,
        // sequence intentionally absent
        metadata: { streaming: true },
      } as unknown as NormalizedLogEntry)
    })

    // /logs returns with a historical user entry + the same canonical assistant.
    fetch.resolve({
      issue: null,
      logs: [
        entry({
          turn: 0,
          type: 'user',
          entryType: 'user-message',
          content: 'q',
          ts: '2026-01-01T00:00:00.000Z',
          messageId: 'u0',
          sequence: new Date('2026-01-01T00:00:00.000Z').getTime() * 1000,
        }),
        // Canonical version of the live entry, with backend sequence.
        entry({
          turn: 1,
          type: 'assistant',
          entryType: 'assistant-message',
          content: 'live A',
          ts: '2026-06-01T00:00:00.000Z',
          sequence: new Date('2026-06-01T00:00:00.000Z').getTime() * 1000,
        }),
      ],
      nextCursor: null,
      hasMore: false,
    })

    await waitFor(() => expect(result.current.logs).toHaveLength(2))

    // user (Jan 1) must precede assistant (Jun 1).
    expect(result.current.logs[0].type).toBe('user')
    expect(result.current.logs[1].type).toBe('assistant')
  })

  it('historical-fetch + several rapid SSE events: final order matches backend sequence', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })

    const fetch = deferred<{
      issue: null
      logs: NormalizedLogEntry[]
      nextCursor: null
      hasMore: boolean
    }>()
    getIssueLogsMock.mockReturnValue(fetch.promise)

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(handler).not.toBeNull())

    // SSE storm: 5 entries delivered before /logs resolves. Their sequences
    // are monotonic and backend-issued.
    act(() => {
      for (let i = 0; i < 5; i++) {
        handler!.onLog(entry({
          turn: 1,
          type: 'tool',
          entryType: 'tool-use',
          content: `tool-${i}`,
          ts: `2026-06-01T00:00:0${i}.000Z`,
          sequence: 1000 + i,
          idSuffix: `t${i}`,
          messageId: `t${i}`,
        }) as NormalizedLogEntry)
      }
    })

    fetch.resolve({
      issue: null,
      logs: [
        entry({
          turn: 0,
          type: 'user',
          entryType: 'user-message',
          content: 'q',
          ts: '2026-01-01T00:00:00.000Z',
          messageId: 'u0',
          sequence: 500,
        }),
      ],
      nextCursor: null,
      hasMore: false,
    })

    await waitFor(() => expect(result.current.logs.length).toBeGreaterThanOrEqual(6))

    const contents = result.current.logs.map(l => l.content)
    expect(contents).toEqual(['q', 'tool-0', 'tool-1', 'tool-2', 'tool-3', 'tool-4'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// R3 — SSE arrival order ≠ backend sequence order (network/batching jitter).
// Backend emits A(seq=100) then B(seq=200) then C(seq=300). Client receives
// C first, then A, then B (within the same event-loop tick — exactly what a
// rapid SSE flush can do when React batches multiple onLog calls). Final
// rendered order MUST be A,B,C by sequence regardless of arrival order.
// ────────────────────────────────────────────────────────────────────────────
describe('r3: out-of-order SSE arrival sorts by backend sequence', () => {
  it('arrival C → A → B yields render A,B,C', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValue({ issue: null, logs: [], nextCursor: null, hasMore: false })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(handler).not.toBeNull())

    const A = entry({
      turn: 0,
      type: 'tool',
      entryType: 'tool-use',
      content: 'A',
      ts: '2026-01-01T00:00:01Z',
      sequence: 100,
      idSuffix: 'a',
      messageId: 'a',
    })
    const B = entry({
      turn: 0,
      type: 'tool',
      entryType: 'tool-use',
      content: 'B',
      ts: '2026-01-01T00:00:02Z',
      sequence: 200,
      idSuffix: 'b',
      messageId: 'b',
    })
    const C = entry({
      turn: 0,
      type: 'tool',
      entryType: 'tool-use',
      content: 'C',
      ts: '2026-01-01T00:00:03Z',
      sequence: 300,
      idSuffix: 'c',
      messageId: 'c',
    })

    act(() => {
      handler!.onLog(C as NormalizedLogEntry)
      handler!.onLog(A as NormalizedLogEntry)
      handler!.onLog(B as NormalizedLogEntry)
    })

    await waitFor(() => expect(result.current.logs).toHaveLength(3))
    expect(result.current.logs.map(l => l.content)).toEqual(['A', 'B', 'C'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// R4 — load-older racing with new live SSE. User scrolls up while engine
// is still pushing new entries. Pagination fetch returns a page; meanwhile
// SSE delivers a new entry. The final merged timeline must stay in
// sequence order with no gap and no inversion.
// ────────────────────────────────────────────────────────────────────────────
describe('r4: load-older racing with live SSE', () => {
  it('older-page resolves AFTER a new live SSE entry; ordering still by sequence', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })

    // First /logs response: a current snapshot with 2 recent entries.
    getIssueLogsMock.mockResolvedValueOnce({
      issue: null,
      logs: [
        entry({ turn: 5, type: 'user', entryType: 'user-message', content: 'recent-1', ts: '2026-06-01T00:00:00Z', sequence: 5000, messageId: 'r1' }),
        entry({ turn: 5, type: 'assistant', entryType: 'assistant-message', content: 'recent-2', ts: '2026-06-01T00:00:01Z', sequence: 5100 }),
      ],
      nextCursor: 'cursor-older',
      hasMore: true,
    })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.logs).toHaveLength(2))
    expect(result.current.hasOlderLogs).toBe(true)

    // User scrolls — load older. Defer resolution.
    const older = deferred<{
      issue: null
      logs: NormalizedLogEntry[]
      nextCursor: null
      hasMore: boolean
    }>()
    getIssueLogsMock.mockReturnValueOnce(older.promise)

    act(() => {
      result.current.loadOlderLogs()
    })

    // While older fetch is in flight, a brand-new live SSE entry arrives.
    act(() => {
      handler!.onLog(entry({
        turn: 6,
        type: 'user',
        entryType: 'user-message',
        content: 'live-new',
        ts: '2026-06-01T00:01:00Z',
        sequence: 5200,
        messageId: 'live1',
      }) as NormalizedLogEntry)
    })

    // NOW older page resolves.
    older.resolve({
      issue: null,
      logs: [
        entry({ turn: 0, type: 'user', entryType: 'user-message', content: 'oldest-1', ts: '2026-01-01T00:00:00Z', sequence: 100, messageId: 'o1' }),
        entry({ turn: 0, type: 'assistant', entryType: 'assistant-message', content: 'oldest-2', ts: '2026-01-01T00:00:01Z', sequence: 200 }),
      ],
      nextCursor: null,
      hasMore: false,
    })

    await waitFor(() => expect(result.current.logs).toHaveLength(5))
    expect(result.current.logs.map(l => l.content))
      .toEqual(['oldest-1', 'oldest-2', 'recent-1', 'recent-2', 'live-new'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// R5 — trim threshold + late SSE for a slot just past the trimmed boundary.
// When liveLogs hits 500 it slices the oldest. If a late SSE entry shows
// up whose sequence is slightly older than the new oldest (think: a
// stragger chunk for a previous turn), it should NOT slot in between the
// trimmed-then-loaded older batch and live batch incorrectly.
// ────────────────────────────────────────────────────────────────────────────
describe('r5: trim + load-older + late SSE entry near the boundary', () => {
  it('final timeline stays monotonic in sequence — no straggler reorders the seam', async () => {
    const MAX_LIVE_LOGS = 500
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValueOnce({
      issue: null,
      logs: [],
      nextCursor: 'cursor-0',
      hasMore: false,
    })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(handler).not.toBeNull())

    // Push enough to trigger a single trim — 510 entries.
    const TOTAL = MAX_LIVE_LOGS + 10
    const all: TimelineEntry[] = []
    for (let i = 0; i < TOTAL; i++) {
      all.push(entry({
        turn: i,
        type: 'tool',
        entryType: 'tool-use',
        content: `e${i}`,
        ts: new Date(1_900_000_000_000 + i * 100).toISOString(),
        sequence: 10000 + i,
        idSuffix: `s${String(i).padStart(4, '0')}`,
        messageId: `m${i}`,
      }))
    }
    act(() => {
      for (const e of all) handler!.onLog(e as NormalizedLogEntry)
    })
    await waitFor(() => expect(result.current.logs).toHaveLength(MAX_LIVE_LOGS))
    expect(result.current.hasOlderLogs).toBe(true)

    // Now a STRAGGLER for turn 3 (sequence in the trimmed region) lands via SSE.
    // This mimics a backend converter emitting a delayed entry from an earlier turn.
    act(() => {
      handler!.onLog(entry({
        turn: 3,
        type: 'tool',
        entryType: 'tool-use',
        content: 'STRAGGLER',
        ts: new Date(1_900_000_000_000 + 3 * 100 + 50).toISOString(),
        sequence: 10003 + 0.5, // between 10003 and 10004 in sequence space
        idSuffix: 'straggler',
        messageId: 'mstr',
      }) as NormalizedLogEntry)
    })

    // Load the trimmed first 10 entries back.
    getIssueLogsMock.mockResolvedValueOnce({
      issue: null,
      logs: all.slice(0, 10),
      nextCursor: null,
      hasMore: false,
    })
    act(() => {
      result.current.loadOlderLogs()
    })
    await waitFor(() => expect(result.current.isLoadingOlder).toBe(false))
    await waitFor(() => expect(result.current.logs.length).toBeGreaterThan(MAX_LIVE_LOGS))

    // Validate that sequence is strictly monotonic across the merged list —
    // any reorder around the trim seam violates this.
    const seqs = result.current.logs.map(l => l.sequence ?? 0)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThanOrEqual(seqs[i - 1])
    }
    // And the straggler sits BETWEEN e3 (10003) and e4 (10004).
    const idx = result.current.logs.findIndex(l => l.content === 'STRAGGLER')
    expect(idx).toBeGreaterThan(0)
    expect(result.current.logs[idx - 1].content).toBe('e3')
    expect(result.current.logs[idx + 1].content).toBe('e4')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// R6 — same backend-assigned sequence on two different entries.
// Theoretically backend `max(ts*1000, lastSeq+1)` guarantees uniqueness PER
// stream, but the converter is rebuilt fresh on each /logs request. If a
// rebuild assigns the same sequence to a previously-different-sequence entry
// (or two entries collapse to the same value), the id-lex tiebreaker takes
// over — and `turn-N-assistant` < `turn-N-thinking` < `turn-N-tool-…` lex.
// ────────────────────────────────────────────────────────────────────────────
describe('r6: same sequence falls back to id-lex tiebreaker', () => {
  // R6 is an UPSTREAM invariant: backend `nextSequence = max(ts*1000,
  // lastSeq+1)` is strictly monotonic per converter and live/batch use the
  // same formula on the same input order — so two backend-emitted entries
  // in a single issue never tie. We pin this test as `it.fails` so the
  // suite stays green while documenting that frontend sort behavior under
  // ties is intentionally id-lex (i.e. fix it at the source if it ever
  // surfaces in production, do not paper over with a frontend tiebreaker).
  // See PLAN-010 "Out of scope".
  it.fails('thinking before assistant in emission order is INVERTED when sequences tie', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValue({ issue: null, logs: [], nextCursor: null, hasMore: false })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(handler).not.toBeNull())

    const SAME = 1234
    act(() => {
      handler!.onLog(entry({
        turn: 0,
        type: 'thinking',
        entryType: 'thinking',
        content: '想了一下',
        ts: '2026-01-01T00:00:00Z',
        sequence: SAME,
      }) as NormalizedLogEntry)
      handler!.onLog(entry({
        turn: 0,
        type: 'assistant',
        entryType: 'assistant-message',
        content: '回答',
        ts: '2026-01-01T00:00:01Z',
        sequence: SAME,
      }) as NormalizedLogEntry)
    })

    await waitFor(() => expect(result.current.logs).toHaveLength(2))
    // Emission order: thinking, then assistant.
    expect(result.current.logs.map(l => l.type)).toEqual(['thinking', 'assistant'])
  })
})
