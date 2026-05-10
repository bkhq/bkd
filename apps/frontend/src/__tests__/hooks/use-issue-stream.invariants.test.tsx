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
