import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'
import type { NormalizedLogEntry, SessionStatus, TimelineEntry } from '@/types/kanban'
import { queryKeys } from './use-kanban'

interface UseIssueStreamOptions {
  projectId: string
  issueId: string | null
  sessionStatus?: SessionStatus | null
  enabled?: boolean
  types?: readonly string[]
}

interface UseIssueStreamReturn {
  logs: TimelineEntry[]
  sessionStatus: SessionStatus | null
  hasOlderLogs: boolean
  isLoadingOlder: boolean
  loadOlderLogs: () => void
  clearLogs: () => void
  refreshLogs: () => void
  removeEntries: (ids: string[]) => void
  appendServerMessage: (
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) => void
}

const TERMINAL: Set<string> = new Set(['completed', 'failed', 'cancelled'])
const MAX_LIVE_LOGS = 500

/**
 * Sort by backend-assigned monotonic `sequence` for strict insertion order.
 * Falls back to (turnIndex, timestamp) for entries that pre-date the field
 * (legacy DB rows), and finally to id for total stability.
 */
function compareTimeline(a: TimelineEntry, b: TimelineEntry): number {
  const sa = a.sequence
  const sb = b.sequence
  if (sa !== undefined && sb !== undefined) return sa - sb
  // Mixed legacy + new: legacy rows go first to keep history stable.
  if (sa === undefined && sb !== undefined) return -1
  if (sa !== undefined && sb === undefined) return 1

  const ta = a.turnIndex ?? 0
  const tb = b.turnIndex ?? 0
  if (ta !== tb) return ta - tb
  const tsa = a.timestamp ? new Date(a.timestamp).getTime() : 0
  const tsb = b.timestamp ? new Date(b.timestamp).getTime() : 0
  if (tsa !== tsb) return tsa - tsb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Convert backend NormalizedLogEntry to frontend TimelineEntry.
 *  Backend already sends TimelineEntry (with stable id) via SSE — use it directly.
 */
function toTimelineEntry(entry: NormalizedLogEntry): TimelineEntry {
  // Backend TimelineEntry extends NormalizedLogEntry and adds id + type
  const e = entry as Partial<TimelineEntry>
  if (e.id && e.type) {
    return entry as TimelineEntry
  }

  // Fallback: generate id locally for plain NormalizedLogEntry
  const typeMap: Record<string, TimelineEntry['type']> = {
    'thinking': 'thinking',
    'assistant-message': 'assistant',
    'tool-use': 'tool',
    'system-message': 'system',
    'error-message': 'error',
    'user-message': 'user',
  }
  const type = typeMap[entry.entryType] ?? 'system'
  const turn = entry.turnIndex ?? 0
  const id = type === 'assistant' || type === 'thinking'
    ? `turn-${turn}-${type}`
    : `turn-${turn}-${type}-${entry.messageId ?? Date.now()}`

  // Synthetic sequence for legacy entries that pre-date the backend field.
  // Mirrors the backend formula: ms-since-epoch * 1000 so legacy entries
  // sort consistently against modern ones (modern wins on tie because
  // they have larger or equal values from the canonical converter).
  const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
  return {
    ...entry,
    id,
    type,
    sequence: ts * 1000,
  } as TimelineEntry
}

// ---- LRU cache ----
const LOGS_CACHE_MAX = 20
const logsCache = new Map<string, TimelineEntry[]>()

function getCachedLogs(scope: string): TimelineEntry[] | undefined {
  const cached = logsCache.get(scope)
  if (cached !== undefined) {
    logsCache.delete(scope)
    logsCache.set(scope, cached)
  }
  return cached
}

function setCachedLogs(scope: string, entries: TimelineEntry[]): void {
  if (logsCache.size >= LOGS_CACHE_MAX && !logsCache.has(scope)) {
    const firstKey = logsCache.keys().next().value
    if (firstKey !== undefined) logsCache.delete(firstKey)
  }
  logsCache.delete(scope)
  logsCache.set(scope, entries)
}

export function useIssueStream({
  projectId,
  issueId,
  sessionStatus: externalStatus,
  enabled = true,
  types,
}: UseIssueStreamOptions): UseIssueStreamReturn {
  const typesKey = types && types.length > 0 ? types.toSorted().join(',') : ''
  const typesFilter = useMemo(
    () => (typesKey ? typesKey.split(',') : undefined),
    [typesKey],
  )
  const typesSetRef = useRef<Set<string> | null>(null)
  typesSetRef.current = typesFilter ? new Set(typesFilter) : null

  const [liveLogs, setLiveLogs] = useState<TimelineEntry[]>([])
  const [olderLogs, setOlderLogs] = useState<TimelineEntry[]>([])
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(externalStatus ?? null)
  const [hasOlderLogs, setHasOlderLogs] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const queryClient = useQueryClient()
  const [_refreshCounter, setRefreshCounter] = useState(0)

  const doneReceivedRef = useRef(false)
  const activeExecutionRef = useRef<string | null>(null)
  const streamScopeRef = useRef<string | null>(null)
  const olderCursorRef = useRef<string | null>(null)
  const liveLogsRef = useRef<TimelineEntry[]>([])
  const olderLogsRef = useRef<TimelineEntry[]>([])
  const trimCursorSetRef = useRef(false)

  // Scope change
  const currentScope = `${projectId}:${issueId}:${typesKey}`
  const prevScopeRef = useRef(currentScope)
  if (prevScopeRef.current !== currentScope) {
    if (liveLogsRef.current.length > 0) {
      setCachedLogs(prevScopeRef.current, liveLogsRef.current)
    }
    prevScopeRef.current = currentScope
    setOlderLogs([])
    setSessionStatus(externalStatus ?? null)
    setHasOlderLogs(false)
    setIsLoadingOlder(false)
    olderLogsRef.current = []
    olderCursorRef.current = null
    doneReceivedRef.current = false
    activeExecutionRef.current = null
    trimCursorSetRef.current = false

    const cached = getCachedLogs(currentScope)
    if (cached && cached.length > 0) {
      setLiveLogs(cached)
      liveLogsRef.current = cached
    } else {
      setLiveLogs([])
      liveLogsRef.current = []
    }
  }

  // ---- Core: merge older + live by stable id ----
  const logs = useMemo(() => {
    const map = new Map<string, TimelineEntry>()
    for (const entry of olderLogs) map.set(entry.id, entry)
    for (const entry of liveLogs) map.set(entry.id, entry)
    return Array.from(map.values()).sort(compareTimeline)
  }, [olderLogs, liveLogs])

  const clearLogs = useCallback(() => {
    liveLogsRef.current = []
    olderLogsRef.current = []
    setLiveLogs([])
    setOlderLogs([])
    setHasOlderLogs(false)
    olderCursorRef.current = null
    doneReceivedRef.current = false
    activeExecutionRef.current = null
    trimCursorSetRef.current = false
  }, [])

  const refreshLogs = useCallback(() => {
    clearLogs()
    setRefreshCounter(c => c + 1)
  }, [clearLogs])

  /**
   * Match an existing entry to a new one by:
   *   1. exact id (normal upsert path), OR
   *   2. same messageId — handles optimistic entries (id = raw messageId)
   *      colliding with canonical entries (id = `turn-N-user-{messageId}`).
   *      Without this, the user-message render duplicates, and the optimistic
   *      copy sticks at the wrong position with no sequence assigned.
   */
  function findExisting(prev: TimelineEntry[], entry: TimelineEntry): number {
    const byId = prev.findIndex(e => e.id === entry.id)
    if (byId >= 0) return byId
    if (entry.messageId) {
      return prev.findIndex(e => e.messageId === entry.messageId)
    }
    return -1
  }

  /** Append or replace */
  const appendEntry = useCallback((entry: TimelineEntry) => {
    setLiveLogs((prev) => {
      const idx = findExisting(prev, entry)
      let next: TimelineEntry[]
      if (idx >= 0) {
        next = [...prev]
        next[idx] = entry
      } else {
        next = [...prev, entry]
      }
      if (next.length > MAX_LIVE_LOGS) {
        next = next.slice(next.length - MAX_LIVE_LOGS)
        setHasOlderLogs(true)
        const oldest = next[0]
        if (oldest?.id) olderCursorRef.current = oldest.id
        trimCursorSetRef.current = true
      }
      liveLogsRef.current = next
      return next
    })
  }, [])

  /** Replace if exists (by id or messageId), else append */
  const upsertEntry = useCallback((entry: TimelineEntry) => {
    setLiveLogs((prev) => {
      const idx = findExisting(prev, entry)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = entry
        liveLogsRef.current = next
        return next
      }
      const next = [...prev, entry]
      liveLogsRef.current = next
      return next
    })
  }, [])

  const appendServerMessage = useCallback(
    (messageId: string, content: string, metadata?: Record<string, unknown>) => {
      const trimmed = content.trim()
      const hasAttachments =
        Array.isArray(metadata?.attachments) && (metadata.attachments as unknown[]).length > 0
      if (!trimmed && !hasAttachments) return
      if (metadata?.type !== 'pending') {
        doneReceivedRef.current = false
      }
      // Optimistic add — gets replaced by the canonical SSE entry within ms
      // (see findExisting: matches on messageId when ids differ, which they
      // do because backend prefixes user ids with `turn-{N}-user-`).
      //
      // Sequence is `Date.now() * 1000` to mirror the backend's timestamp-
      // based sequence formula, so the optimistic entry sorts to the bottom
      // of the timeline immediately. Without this, an undefined `sequence`
      // sorted before all backend entries (root cause: post-restart user
      // message disappearing until refresh).
      const now = Date.now()
      appendEntry({
        id: messageId,
        messageId,
        turnIndex: 0,
        type: 'user',
        entryType: 'user-message',
        content: trimmed,
        timestamp: new Date(now).toISOString(),
        sequence: now * 1000,
        metadata: metadata ?? {},
      })
    },
    [appendEntry],
  )

  const removeEntries = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    setLiveLogs((prev) => {
      const next = prev.filter(e => !idSet.has(e.id))
      liveLogsRef.current = next
      return next
    })
    setOlderLogs((prev) => {
      const next = prev.filter(e => !idSet.has(e.id))
      olderLogsRef.current = next
      return next
    })
  }, [])

  const loadOlderLogs = useCallback(() => {
    if (!issueId || !olderCursorRef.current || isLoadingOlder) return
    setIsLoadingOlder(true)

    kanbanApi
      .getIssueLogs(projectId, issueId, { before: olderCursorRef.current, types: typesFilter })
      .then((data) => {
        if (!data.logs.length) {
          setHasOlderLogs(false)
          olderCursorRef.current = null
          return
        }
        olderCursorRef.current = data.nextCursor
        setHasOlderLogs(data.hasMore)
        setOlderLogs((prev) => {
          // Dedup by id — repeated loads (rare but possible on cursor edges)
          // would otherwise stack duplicates in the array even though the
          // outer logs useMemo dedupes for render.
          const map = new Map<string, TimelineEntry>()
          for (const e of prev) map.set(e.id, e)
          for (const e of data.logs) map.set(e.id, e)
          const next = Array.from(map.values()).sort(compareTimeline)
          olderLogsRef.current = next
          return next
        })
      })
      .catch((err) => {
        console.warn('Failed to load older logs:', err)
      })
      .finally(() => {
        setIsLoadingOlder(false)
      })
  }, [projectId, issueId, isLoadingOlder, typesFilter])

  // Scope / status effects
  useEffect(() => {
    if (!issueId || !enabled) {
      streamScopeRef.current = null
      setSessionStatus(externalStatus ?? null)
      clearLogs()
      return
    }
    const scope = `${projectId}:${issueId}:${typesKey}`
    if (streamScopeRef.current !== scope) {
      streamScopeRef.current = scope
      setSessionStatus(externalStatus ?? null)
      clearLogs()
    }
  }, [projectId, issueId, enabled, clearLogs, externalStatus, typesKey])

  useEffect(() => {
    if (!issueId || !enabled) return
    const hasActiveExecution = activeExecutionRef.current !== null
    const next = externalStatus ?? null
    if (!hasActiveExecution || next === 'running' || next === 'pending') {
      setSessionStatus(next)
    }
  }, [issueId, enabled, externalStatus])

  // Fetch historical logs
  useEffect(() => {
    if (!issueId || !enabled) return
    const scope = `${projectId}:${issueId}:${typesKey}`
    let cancelled = false

    kanbanApi
      .getIssueLogs(projectId, issueId, typesFilter ? { types: typesFilter } : undefined)
      .then((data) => {
        if (cancelled || streamScopeRef.current !== scope) return
        setLiveLogs((prev) => {
          if (prev.length === 0) {
            liveLogsRef.current = data.logs
            return data.logs
          }
          // Fresh data from /logs is the authoritative reconstruction
          // (TimelineConverter on the server rebuilt it from the full log
          // history). It must override any cached/streaming snapshot for
          // the same id — cached state may have intermediate streaming
          // content that's now superseded.
          //
          // Order: cache first, fresh data overwrites by id.
          const map = new Map<string, TimelineEntry>()
          for (const e of prev) map.set(e.id, e)
          for (const e of data.logs) map.set(e.id, e)
          const next = Array.from(map.values()).sort(compareTimeline)
          liveLogsRef.current = next
          return next
        })
        olderLogsRef.current = []
        setOlderLogs([])
        setCachedLogs(scope, data.logs)
        setHasOlderLogs(data.hasMore || trimCursorSetRef.current)
        if (!trimCursorSetRef.current) {
          olderCursorRef.current = data.nextCursor
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch issue logs:', err)
      })

    return () => {
      cancelled = true
    }
  }, [projectId, issueId, enabled, _refreshCounter, typesKey, typesFilter])

  // Subscribe to SSE via EventBus
  useEffect(() => {
    if (!issueId || !enabled) return
    doneReceivedRef.current = false

    const cleanup = { unsub: (() => {}) as () => void }

    cleanup.unsub = eventBus.subscribe(issueId, {
      onLog: (entry) => {
        // Previously this handler dropped late-arriving entries when
        // doneReceivedRef was true ("done already came, ignore tail"). That
        // assumption broke whenever the SSE done event raced ahead of the
        // last log chunks, causing the tail of the response to vanish until
        // the user refreshed. Backend now flushes all pending streaming
        // buffers BEFORE emitting done (see settle.ts → flushTimelineConverter)
        // so late entries are no longer expected — but we still accept them
        // defensively if any slip through, since onDone refetches /logs.
        const allowed = typesSetRef.current
        if (allowed && !allowed.has(entry.entryType)) return
        appendEntry(toTimelineEntry(entry))
      },
      onLogUpdated: (entry) => {
        const allowed = typesSetRef.current
        if (allowed && !allowed.has(entry.entryType)) return
        upsertEntry(toTimelineEntry(entry))
      },
      onLogRemoved: (messageIds) => {
        removeEntries(messageIds)
      },
      onState: (data) => {
        if (data.state === 'running' || data.state === 'pending') {
          activeExecutionRef.current = data.executionId
          doneReceivedRef.current = false
          setSessionStatus(data.state)
        } else if (TERMINAL.has(data.state)) {
          if (data.executionId === activeExecutionRef.current) {
            doneReceivedRef.current = true
            activeExecutionRef.current = null
            setSessionStatus(data.state)
          }
        }
        queryClient.invalidateQueries({
          queryKey: queryKeys.issue(projectId, issueId),
        })
      },
      onDone: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(projectId, issueId) })
        queryClient.invalidateQueries({ queryKey: queryKeys.issues(projectId) })
        // Final reconciliation: refetch the canonical timeline from the
        // server. If any chunk was missed during streaming (drop, race,
        // backend converter desync), this brings the client to ground truth.
        // Cheap because the LRU cache already has most of it; the merge
        // map dedupes by id so existing entries are unchanged.
        setRefreshCounter(c => c + 1)
      },
    })

    queryClient.invalidateQueries({ queryKey: queryKeys.issue(projectId, issueId) })

    return () => {
      cleanup.unsub()
    }
  }, [projectId, issueId, enabled, queryClient, appendEntry, upsertEntry, removeEntries])

  // Resume from background
  useEffect(() => {
    if (!issueId || !enabled) return
    return eventBus.onResume(() => {
      refreshLogs()
    })
  }, [issueId, enabled, refreshLogs])

  return {
    logs,
    sessionStatus,
    hasOlderLogs,
    isLoadingOlder,
    loadOlderLogs,
    clearLogs,
    refreshLogs,
    removeEntries,
    appendServerMessage,
  }
}
