import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIssueStream } from '@/hooks/use-issue-stream'
import type { IssueEventHandler } from '@/lib/event-bus'
import type { NormalizedLogEntry, TimelineEntry } from '@/types/kanban'

// ────────────────────────────────────────────────────────────────────────────
// Frontend invariants — covering the recurring "ChatUI shows wrong thing"
// classes of bug at the hook level so we don't need to look at screenshots
// to know they're regressions.
//
// Each `it` block names the SPECIFIC USER-VISIBLE BUG it pins down. If the
// description sounds like something a user would complain about, this is the
// right place for the test.
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

/**
 * Mimic ACTUAL backend converter output — the on-the-wire shape that SSE
 * delivers and /logs returns. Critically: includes `messageId` (the field
 * I forgot to preserve in the converter, which let the screenshot bug
 * slip through dedup).
 *
 * If you find yourself "fixing" this helper to make a test pass, STOP —
 * the test should match the backend's real output. Update the converter
 * instead.
 */
function backendUserEntry(messageId: string, turn: number, ts: string, content: string): TimelineEntry {
  return {
    id: `turn-${turn}-user-${messageId}`,
    messageId, // ← backend MUST output this; verified by backend invariants
    turnIndex: turn,
    type: 'user',
    entryType: 'user-message',
    content,
    timestamp: ts,
    sequence: new Date(ts).getTime() * 1000,
    metadata: {},
  }
}

function backendThinkingEntry(turn: number, ts: string, content: string, streaming: boolean, messageId?: string): TimelineEntry {
  return {
    id: `turn-${turn}-thinking`,
    messageId,
    turnIndex: turn,
    type: 'thinking',
    entryType: 'thinking',
    content,
    timestamp: ts,
    sequence: new Date(ts).getTime() * 1000,
    metadata: { streaming },
  }
}

describe('invariant: user follow-up message appears immediately at the bottom', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('"我的回复直接就没了，刷新就出来了" — optimistic + canonical produce ONE visible entry', async () => {
    // Reproduces: send message → optimistic add → SSE delivers canonical
    // with id=`turn-N-user-{messageId}` (different id from optimistic which
    // uses raw messageId). Without messageId-based dedup, two copies render.
    // With my fix, findExisting matches by messageId and the canonical
    // replaces the optimistic.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })

    // History has a few prior turns with high sequence numbers.
    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [
        backendUserEntry('u_old', 0, '2026-01-01T00:00:00Z', 'old'),
        backendThinkingEntry(0, '2026-01-01T00:00:01Z', 'thought', false),
      ],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () => useIssueStream({
        projectId: 'p',
        issueId: 'i',
        sessionStatus: 'running',
      }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.logs).toHaveLength(2))

    // User sends "新消息" — frontend calls appendServerMessage with the
    // server-assigned messageId. The optimistic entry has id=messageId
    // (not turn-N-user-messageId). It must position correctly (at bottom)
    // immediately, not wait for refresh.
    const messageId = 'u_new'
    act(() => {
      result.current.appendServerMessage(messageId, '新消息')
    })

    // Right after optimistic add: still 3 entries (2 + 1 optimistic).
    expect(result.current.logs).toHaveLength(3)
    // Optimistic at the BOTTOM of the timeline (sorted by sequence — its
    // sequence is Date.now()*1000 which is much larger than fixture ts).
    expect(result.current.logs.at(-1)?.content).toBe('新消息')

    // SSE then delivers the canonical entry with backend-shaped id.
    act(() => {
      handler?.onLog({
        ...backendUserEntry(messageId, 1, new Date().toISOString(), '新消息'),
      } as NormalizedLogEntry)
    })

    // Crucial: still 3 entries. NOT 4. The messageId-based dedup replaces
    // the optimistic with canonical.
    expect(result.current.logs).toHaveLength(3)
    expect(result.current.logs.at(-1)?.content).toBe('新消息')
    // The visible entry now has the canonical id (replaced).
    expect(result.current.logs.at(-1)?.id).toBe(`turn-1-user-${messageId}`)
  })

  it('user message stays at bottom even when SSE arrives BEFORE the optimistic add', async () => {
    // Race condition: SSE log event can technically arrive before the HTTP
    // POST response returns. The dedup must still happen — order of
    // optimistic vs canonical shouldn't matter.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(getIssueLogsMock).toHaveBeenCalled())

    const messageId = 'u_race'

    // SSE first
    act(() => {
      handler?.onLog(
        backendUserEntry(messageId, 1, '2026-01-01T00:00:05Z', 'race') as NormalizedLogEntry,
      )
    })
    expect(result.current.logs).toHaveLength(1)

    // Optimistic second (caller didn't know SSE got there first)
    act(() => {
      result.current.appendServerMessage(messageId, 'race')
    })

    // Still 1 entry — dedup matched by messageId.
    expect(result.current.logs).toHaveLength(1)
  })
})

describe('invariant: no entry has stale streaming=true after a new turn starts', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('"思考块和后面的助手回复粘成一团" — closing thinking marks streaming=false on client too', async () => {
    // Backend bug class: engine SIGKILLs while a thinking buffer is open;
    // its streaming=true persists; later turn renders it as live, flowing
    // visually into the next assistant.
    //
    // With my fix, the SSE 'log' event for the closed buffer carries
    // streaming=false. Hook simply forwards it. We assert: after receiving
    // the closing emit, the entry's streaming flag is false on the client.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(getIssueLogsMock).toHaveBeenCalled())

    // Engine emits a streaming chunk (intermediate snapshot).
    act(() => {
      handler?.onLog(
        backendThinkingEntry(0, '2026-01-01T00:00:00Z', 'partial', true) as NormalizedLogEntry,
      )
    })
    expect(result.current.logs).toHaveLength(1)
    expect(result.current.logs[0].metadata?.streaming).toBe(true)

    // Engine emits the closing snapshot (e.g. due to tool interrupting,
    // or settle flush, or turn boundary). Same id, but streaming=false now.
    act(() => {
      handler?.onLog(
        backendThinkingEntry(0, '2026-01-01T00:00:01Z', 'partial', false) as NormalizedLogEntry,
      )
    })

    expect(result.current.logs).toHaveLength(1)
    expect(result.current.logs[0].metadata?.streaming).toBe(false)
  })
})

describe('invariant: refresh after backend restart converges to canonical state', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('onDone refetches /logs as final reconciliation (mask any stream drops)', async () => {
    // Backend can race: 'done' event reaches client before all 'log' events.
    // Without onDone refetch, the missing tail content forces user to refresh.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })

    let fetchCount = 0
    getIssueLogsMock.mockImplementation(() => {
      fetchCount++
      return Promise.resolve({
        issue: null,
        logs: fetchCount > 1
          ? [backendThinkingEntry(0, '2026-01-01T00:00:00Z', 'tail content arrived late', false)]
          : [],
        nextCursor: null,
        hasMore: false,
      })
    })

    renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(fetchCount).toBe(1))

    act(() => {
      handler?.onDone({ executionId: 'e1', finalStatus: 'completed' })
    })

    // onDone must trigger a second fetch — guarantees client re-syncs.
    await waitFor(() => expect(fetchCount).toBeGreaterThanOrEqual(2))
  })
})

describe('invariant: optimistic position survives intermediate entries', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('user message stays at bottom even when a loading entry lands between optimistic and canonical', async () => {
    // Reproduces the "我刚发的消息跑到 loading 后面去了" symptom:
    // 1. user clicks send → frontend appends optimistic at sequence T1.
    // 2. before canonical user-message arrives, the engine emits a system /
    //    loading entry with a slightly later timestamp; SSE delivers it.
    // 3. canonical user-message finally arrives; messageId-based dedup
    //    REPLACES the optimistic entry with the canonical one.
    //
    // If the canonical's sequence is smaller than the in-flight loading
    // entry, the timeline re-sorts and the user's own message ends up ABOVE
    // (i.e., earlier than) a system entry that the user perceives as
    // happening AFTER they pressed send. The fix: optimistic sequence is
    // `max(maxLiveSeq+1, Date.now()*1000)` so any entry observed before the
    // optimistic is positioned earlier; the canonical, by being assigned
    // strictly later (lastSeq+1 on the backend), is also at or after.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(getIssueLogsMock).toHaveBeenCalled())

    // Plant a loading entry already in liveLogs with a sequence that
    // matches a backend "max(ts*1000, lastSeq+1)" — i.e. very large.
    const futureSeq = Date.now() * 1000 + 50
    act(() => {
      handler?.onLog({
        id: 'turn-1-system-loading',
        messageId: 'sys-load',
        turnIndex: 1,
        type: 'system',
        entryType: 'system-message',
        content: 'thinking…',
        timestamp: new Date(Date.now() + 50).toISOString(),
        sequence: futureSeq,
        metadata: { subtype: 'loading' },
      } as NormalizedLogEntry)
    })
    expect(result.current.logs).toHaveLength(1)

    // User sends a message; optimistic add happens AFTER the loading entry
    // landed, so naive `Date.now() * 1000` (which equals or is smaller
    // than `futureSeq`) would let the canonical replacement reorder.
    const messageId = 'u_under_load'
    act(() => {
      result.current.appendServerMessage(messageId, 'hi')
    })

    // Optimistic entry ends up at the bottom (its sequence is max+1).
    expect(result.current.logs).toHaveLength(2)
    expect(result.current.logs.at(-1)?.content).toBe('hi')

    // Canonical entry from backend with its own large sequence — also
    // strictly greater than every previous one (lastSeq+1 semantics).
    const canonicalSeq = futureSeq + 100
    act(() => {
      handler?.onLog({
        id: `turn-1-user-${messageId}`,
        messageId,
        turnIndex: 1,
        type: 'user',
        entryType: 'user-message',
        content: 'hi',
        timestamp: new Date(Date.now() + 100).toISOString(),
        sequence: canonicalSeq,
        metadata: {},
      } as NormalizedLogEntry)
    })

    // After replacement, the user message must STILL be at the bottom.
    expect(result.current.logs).toHaveLength(2)
    expect(result.current.logs.at(-1)?.content).toBe('hi')
    expect(result.current.logs.at(-1)?.id).toBe(`turn-1-user-${messageId}`)
  })
})

describe('invariant: LRU cache survives issue-switch effects', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('switching to issue B then back to A restores A’s logs from cache without blanking', async () => {
    // The bug: render-time inline block restores cached logs into liveLogs,
    // then the scope-change effect calls clearLogs() and wipes them. The
    // user sees a flicker of empty timeline before /logs returns. After the
    // fix, the effect must NOT clear on scope change — only update the
    // scope ref so subscribers swap.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })

    // /logs returns a single canonical entry per issue
    getIssueLogsMock.mockImplementation((_p: string, id: string) => {
      return Promise.resolve({
        issue: null,
        logs: [
          {
            id: `turn-0-user-${id}`,
            messageId: id,
            turnIndex: 0,
            type: 'user',
            entryType: 'user-message',
            content: `from ${id}`,
            timestamp: '2026-01-01T00:00:00Z',
            sequence: new Date('2026-01-01T00:00:00Z').getTime() * 1000,
            metadata: {},
          },
        ],
        nextCursor: null,
        hasMore: false,
      })
    })

    const { result, rerender } = renderHook(
      ({ issueId }: { issueId: string }) => useIssueStream({ projectId: 'p', issueId, sessionStatus: 'completed' }),
      { wrapper: createWrapper(), initialProps: { issueId: 'A' } },
    )
    await waitFor(() => expect(result.current.logs).toHaveLength(1))
    expect(result.current.logs[0].content).toBe('from A')

    // Append a live SSE entry for A — this is what the cache should retain.
    act(() => {
      handler?.onLog({
        id: 'turn-0-assistant-0000',
        messageId: 'a-live',
        turnIndex: 0,
        type: 'assistant',
        entryType: 'assistant-message',
        content: 'live A',
        timestamp: '2026-01-01T00:00:01Z',
        sequence: new Date('2026-01-01T00:00:01Z').getTime() * 1000,
        metadata: {},
      } as NormalizedLogEntry)
    })
    await waitFor(() => expect(result.current.logs).toHaveLength(2))

    // Switch to B
    rerender({ issueId: 'B' })
    await waitFor(() => expect(result.current.logs.some(l => l.content === 'from B')).toBe(true))

    // Switch back to A — at the very first render, the inline restoration
    // block must surface the cached logs WITHOUT the effect wiping them.
    rerender({ issueId: 'A' })
    // Must NEVER drop to an empty array between renders.
    expect(result.current.logs.length).toBeGreaterThan(0)
  })
})

describe('invariant: removeEntries deletes by raw messageId from backend events', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('onLogRemoved with the canonical ULID drops the entry from the timeline', async () => {
    // emitIssueLogRemoved on the backend ships raw ULIDs (DB primary keys);
    // the frontend timeline entries carry id=`turn-N-...`. Without dual-key
    // matching the filter never hit, recalled pending messages lingered.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })
    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [
        {
          id: 'turn-0-user-msg_abc',
          messageId: 'msg_abc',
          turnIndex: 0,
          type: 'user',
          entryType: 'user-message',
          content: 'recalled',
          timestamp: '2026-01-01T00:00:00Z',
          sequence: new Date('2026-01-01T00:00:00Z').getTime() * 1000,
          metadata: { type: 'pending' },
        },
      ],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'completed' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.logs).toHaveLength(1))

    // Backend emits a removal with the raw messageId, NOT the converter id.
    act(() => {
      handler?.onLogRemoved(['msg_abc'])
    })

    expect(result.current.logs).toHaveLength(0)
  })
})

describe('invariant: post-restart sequences sort live entries to the bottom', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('"刚发的消息跑到时间线顶端" — new SSE entry sorts after old batch entries', async () => {
    // The bug after the first BKD restart: live converter sequence reset to
    // 0 and collided with batch sequences 0..N. Now sequences are timestamp-
    // based; new entries always have larger sequence than old ones.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_id: string, h: IssueEventHandler) => {
      handler = h
      return () => {}
    })

    // Old history with 2026-01-01 timestamps.
    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [
        backendUserEntry('u1', 0, '2026-01-01T00:00:00Z', 'old 1'),
        backendUserEntry('u2', 0, '2026-01-01T00:00:01Z', 'old 2'),
        backendUserEntry('u3', 0, '2026-01-01T00:00:02Z', 'old 3'),
      ],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () => useIssueStream({ projectId: 'p', issueId: 'i', sessionStatus: 'running' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.logs).toHaveLength(3))

    // New SSE entry — timestamp from "now" (2026+).
    const nowTs = '2026-12-31T23:59:59Z'
    act(() => {
      handler?.onLog(
        backendUserEntry('u_new', 1, nowTs, 'new') as NormalizedLogEntry,
      )
    })

    expect(result.current.logs).toHaveLength(4)
    expect(result.current.logs.at(-1)?.content).toBe('new')
    // Specifically NOT at index 0 — that was the bug.
    expect(result.current.logs[0]?.content).not.toBe('new')
  })
})
