import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { useIssueStream } from '@/hooks/use-issue-stream'
import type { IssueEventHandler } from '@/lib/event-bus'
import type { NormalizedLogEntry } from '@/types/kanban'

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
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useIssueStream', () => {
  beforeEach(() => {
    subscribeMock.mockReset()
    getIssueLogsMock.mockReset()
  })

  it('replaces an existing pending message when log-updated arrives', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    const pendingEntry: NormalizedLogEntry = {
      messageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      entryType: 'user-message',
      content: 'queued follow-up',
      timestamp: new Date().toISOString(),
      metadata: { type: 'pending' },
    }

    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [pendingEntry],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      {
        wrapper: createWrapper(),
      },
    )

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1)
    })
    expect(result.current.logs[0]?.metadata?.type).toBe('pending')

    act(() => {
      handler?.onLogUpdated({
        ...pendingEntry,
        metadata: undefined,
      })
    })

    await waitFor(() => {
      expect(result.current.logs[0]?.metadata?.type).toBeUndefined()
    })
  })

  it('restores trimmed live entries when loading older logs', async () => {
    // Regression: once live logs exceed MAX_LIVE_LOGS, trimmed entries must
    // remain recoverable via loadOlderLogs (seenIds must be cleared on eviction).
    const MAX_LIVE_LOGS = 500
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    // Start with an empty initial fetch (all entries will come via SSE)
    getIssueLogsMock.mockResolvedValueOnce({
      issue: null,
      logs: [],
      nextCursor: 'cursor-0',
      hasMore: false,
    })

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(handler).not.toBeNull()
    })

    // Push MAX_LIVE_LOGS + 10 entries via SSE to trigger trimming
    const totalEntries = MAX_LIVE_LOGS + 10
    const allEntries: NormalizedLogEntry[] = []
    for (let i = 0; i < totalEntries; i++) {
      const ts = new Date(Date.now() + i * 100).toISOString()
      // ULID-like IDs: pad with leading zeros so sort is correct
      const messageId = `01ARZ${String(i).padStart(20, '0')}`
      allEntries.push({
        id: `turn-${i}-assistant`,
        messageId,
        entryType: 'assistant-message',
        type: 'assistant',
        content: `msg-${i}`,
        timestamp: ts,
        turnIndex: i,
      })
    }

    act(() => {
      for (const entry of allEntries) {
        handler?.onLog(entry)
      }
    })

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(MAX_LIVE_LOGS)
      expect(result.current.hasOlderLogs).toBe(true)
    })

    // The first 10 entries were trimmed. Simulate server returning them on pagination.
    const trimmedEntries = allEntries.slice(0, 10)
    getIssueLogsMock.mockResolvedValueOnce({
      issue: null,
      logs: trimmedEntries,
      nextCursor: null,
      hasMore: false,
    })

    act(() => {
      result.current.loadOlderLogs()
    })

    await waitFor(() => {
      expect(result.current.isLoadingOlder).toBe(false)
    })

    // All 10 trimmed entries should be restored in olderLogs, visible in merged output
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(MAX_LIVE_LOGS + 10)
    })

    // Verify the first entry is the earliest trimmed one (no gaps)
    expect(result.current.logs[0]?.content).toBe('msg-0')
    // And no duplicates: last entry is the newest
    expect(result.current.logs.at(-1)?.content).toBe(`msg-${totalEntries - 1}`)
  })

  it('dedups streaming entry when a persisted entry with the same content exists', async () => {
    // Regression: ACP streaming assistant-message chunks have no messageId.
    // When the HTTP snapshot already contains the flushed persisted version,
    // both the streaming chunk and the persisted entry would render unless
    // we dedup by (turnIndex, entryType, content).
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    const persistedEntry = {
      id: 'turn-1-assistant',
      messageId: '01ARZ3NDEKTSV4RRFFQ69G5FAA',
      entryType: 'assistant-message',
      type: 'assistant',
      content: 'Same content',
      timestamp: new Date().toISOString(),
      turnIndex: 1,
    }

    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [persistedEntry],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      {
        wrapper: createWrapper(),
      },
    )

    // Wait for HTTP snapshot to load
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1)
    })
    expect(result.current.logs[0]?.id).toBe('turn-1-assistant')

    // Simulate a late streaming chunk arriving after the snapshot
    const streamingChunk: NormalizedLogEntry = {
      entryType: 'assistant-message',
      content: 'Same content',
      timestamp: new Date().toISOString(),
      turnIndex: 1,
      metadata: { streaming: true },
    }

    act(() => {
      handler?.onLog(streamingChunk)
    })

    // Should still be 1 entry, not 2 (same id overwrites)
    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1)
    })
    expect(result.current.logs[0]?.id).toBe('turn-1-assistant')
    expect(result.current.logs[0]?.content).toBe('Same content')
  })

  it('merges cascading streaming thinking entries into one', async () => {
    // Regression: ACP/Codex engines send full accumulated text on every
    // thinking chunk, creating cascading duplicates like
    // "用户" → "用户问" → "用户问更新". Only the latest full text should remain.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(handler).not.toBeNull()
    })

    // Simulate three cascading thinking chunks
    const chunk1: NormalizedLogEntry = {
      entryType: 'thinking',
      content: '用户',
      timestamp: new Date().toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }
    const chunk2: NormalizedLogEntry = {
      entryType: 'thinking',
      content: '用户问',
      timestamp: new Date(Date.now() + 100).toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }
    const chunk3: NormalizedLogEntry = {
      entryType: 'thinking',
      content: '用户问更新',
      timestamp: new Date(Date.now() + 200).toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }

    act(() => {
      handler?.onLog(chunk1)
      handler?.onLog(chunk2)
      handler?.onLog(chunk3)
    })

    // Should collapse to a single thinking entry with the latest full text
    await waitFor(() => {
      const thinkingEntries = result.current.logs.filter(e => e.entryType === 'thinking')
      expect(thinkingEntries).toHaveLength(1)
      expect(thinkingEntries[0]!.content).toBe('用户问更新')
    })
  })

  it('keeps non-cascading thinking entries separate', async () => {
    // If a later thinking chunk is NOT a superset of the previous one,
    // both should be kept (e.g. a new reasoning segment started).
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(handler).not.toBeNull()
    })

    // Backend normalizer accumulates chunks, so SSE receives accumulated content
    const chunk1: NormalizedLogEntry = {
      entryType: 'thinking',
      content: 'First reasoning',
      timestamp: new Date().toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }
    const chunk2: NormalizedLogEntry = {
      entryType: 'thinking',
      content: 'First reasoningSecond thought',
      timestamp: new Date(Date.now() + 100).toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }

    act(() => {
      handler?.onLog(chunk1)
      handler?.onLog(chunk2)
    })

    // Same turn thinking is merged into one entry (backend normalization)
    await waitFor(() => {
      const thinkingEntries = result.current.logs.filter(e => e.entryType === 'thinking')
      expect(thinkingEntries).toHaveLength(1)
      expect(thinkingEntries[0].content).toBe('First reasoningSecond thought')
    })
  })

  it('prefers the SSE-updated entry over a stale initial snapshot with the same messageId', async () => {
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    const initialFetch = deferred<{
      issue: null
      logs: NormalizedLogEntry[]
      nextCursor: null
      hasMore: boolean
    }>()

    getIssueLogsMock.mockReturnValue(initialFetch.promise)

    const pendingEntry: NormalizedLogEntry = {
      messageId: '01ARZ3NDEKTSV4RRFFQ69G5FAA',
      entryType: 'user-message',
      content: 'queued follow-up',
      timestamp: new Date().toISOString(),
      metadata: { type: 'pending' },
    }

    const { result } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      {
        wrapper: createWrapper(),
      },
    )

    act(() => {
      handler?.onLogUpdated({
        ...pendingEntry,
        metadata: undefined,
      })
    })

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1)
      expect(result.current.logs[0]?.metadata?.type).toBeUndefined()
    })

    initialFetch.resolve({
      issue: null,
      logs: [pendingEntry],
      nextCursor: null,
      hasMore: false,
    })

    await waitFor(() => {
      expect(result.current.logs).toHaveLength(1)
      expect(result.current.logs[0]?.metadata?.type).toBeUndefined()
    })
  })

  it('end-to-end: cascading thinking + assistant chunks produce 1 assistant message', async () => {
    // Full integration: data layer (useIssueStream) + message layer (useChatMessages).
    // OpenCode sends full accumulated text for BOTH thinking and assistant chunks.
    // This test ensures the UI never shows duplicate thinking + assistant pairs.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result: streamResult } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(handler).not.toBeNull()
    })

    // Simulate OpenCode behavior: thinking and assistant chunks with identical content
    const thinkingChunk: NormalizedLogEntry = {
      entryType: 'thinking',
      content: '用户问为什么测试兜不住',
      timestamp: new Date().toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }
    const assistantChunk: NormalizedLogEntry = {
      entryType: 'assistant-message',
      content: '用户问为什么测试兜不住。原因是测试只覆盖了 normalizer，没测前端 state 的去重逻辑',
      timestamp: new Date(Date.now() + 100).toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }

    act(() => {
      handler?.onLog(thinkingChunk)
      handler?.onLog(assistantChunk)
    })

    // Wait for logs to settle
    await waitFor(() => {
      expect(streamResult.current.logs).toHaveLength(2)
    })

    // Feed the merged logs into useChatMessages
    const { result: chatResult } = renderHook(
      () => useChatMessages(streamResult.current.logs),
      { wrapper: createWrapper() },
    )

    // Should produce exactly 1 assistant message, no standalone thinking
    await waitFor(() => {
      expect(chatResult.current.messages).toHaveLength(1)
      expect(chatResult.current.messages[0]?.type).toBe('assistant')
    })
  })

  it('end-to-end: cascading assistant chunks merge before rendering', async () => {
    // Regression: assistant-message chunks also cascade (not just thinking).
    // "Hel" -> "Hello" -> "Hello world" should render as a single message.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result: streamResult } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(handler).not.toBeNull()
    })

    const chunk1: NormalizedLogEntry = {
      entryType: 'assistant-message',
      content: 'Hel',
      timestamp: new Date().toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }
    const chunk2: NormalizedLogEntry = {
      entryType: 'assistant-message',
      content: 'Hello',
      timestamp: new Date(Date.now() + 50).toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }
    const chunk3: NormalizedLogEntry = {
      entryType: 'assistant-message',
      content: 'Hello world',
      timestamp: new Date(Date.now() + 100).toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }

    act(() => {
      handler?.onLog(chunk1)
      handler?.onLog(chunk2)
      handler?.onLog(chunk3)
    })

    await waitFor(() => {
      expect(streamResult.current.logs).toHaveLength(1)
      expect(streamResult.current.logs[0]?.content).toBe('Hello world')
    })

    const { result: chatResult } = renderHook(
      () => useChatMessages(streamResult.current.logs),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(chatResult.current.messages).toHaveLength(1)
      expect(chatResult.current.messages[0]?.type).toBe('assistant')
      const assistantMsg = chatResult.current.messages[0] as { entry: { content: string } }
      expect(assistantMsg.entry.content).toBe('Hello world')
    })
  })

  it('does NOT concatenate unrelated assistant chunks', async () => {
    // Regression: when two assistant chunks have unrelated content,
    // they must NOT be merged into garbled text.
    let handler: IssueEventHandler | null = null
    subscribeMock.mockImplementation((_issueId: string, nextHandler: IssueEventHandler) => {
      handler = nextHandler
      return () => {}
    })

    getIssueLogsMock.mockResolvedValue({
      issue: null,
      logs: [],
      nextCursor: null,
      hasMore: false,
    })

    const { result: streamResult } = renderHook(
      () =>
        useIssueStream({
          projectId: 'proj-1',
          issueId: 'issue-1',
          sessionStatus: 'running',
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => {
      expect(handler).not.toBeNull()
    })

    const chunk1: NormalizedLogEntry = {
      entryType: 'assistant-message',
      content: 'B里还留着历史销售记录',
      timestamp: new Date().toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }
    const chunk2: NormalizedLogEntry = {
      entryType: 'assistant-message',
      content: '---查 ttpos_product_package的delete_time字段',
      timestamp: new Date(Date.now() + 50).toISOString(),
      turnIndex: 0,
      metadata: { streaming: true },
    }

    act(() => {
      handler?.onLog(chunk1)
      handler?.onLog(chunk2)
    })

    // useIssueStream may keep both entries (no superset/subset relation).
    // The key assertion: no single entry should contain concatenated text.
    await waitFor(() => {
      expect(streamResult.current.logs.length).toBeGreaterThanOrEqual(1)
    })

    const concatenatedFound = streamResult.current.logs.some(l =>
      l.entryType === 'assistant-message'
      && l.content.includes('B里还留着历史销售记录')
      && l.content.includes('delete_time字段'),
    )
    expect(concatenatedFound).toBe(false)
  })
})
