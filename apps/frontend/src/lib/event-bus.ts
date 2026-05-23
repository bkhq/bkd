import type { ChangesSummary, CockpitTimelineDelta } from '@bkd/shared'
import type { NormalizedLogEntry, SessionStatus } from '@/types/kanban'
import { getToken } from './auth'

export interface IssueEventHandler {
  onLog: (entry: NormalizedLogEntry) => void
  onLogUpdated: (entry: NormalizedLogEntry) => void
  onLogRemoved: (messageIds: string[]) => void
  onState: (data: { executionId: string, state: SessionStatus }) => void
  onDone: (data: { executionId: string, finalStatus: SessionStatus }) => void
}

export type ChangesSummaryData = ChangesSummary

type IssueUpdatedListener = (data: { issueId: string, changes: Record<string, unknown>, title?: string, projectAlias?: string, source?: string }) => void
type ChangesSummaryListener = (data: ChangesSummaryData) => void
type IssueActivityListener = (issueId: string) => void
type ConnectionListener = (connected: boolean) => void
type ResumeListener = () => void
type CockpitProposalListener = (data: { proposalId: string, status: 'pending' | 'approved' | 'rejected' | 'failed' }) => void
type CockpitResetListener = (data: { issueId: string }) => void
type CockpitTimelineListener = (delta: CockpitTimelineDelta) => void

const MAX_RECONNECT_DELAY = 30_000
const BASE_RECONNECT_DELAY = 1_000
// Fast fixed-interval retry until first successful connection
const INITIAL_RETRY_DELAY = 1_500
// Watchdog fires if no heartbeat received within 2x server interval + buffer
const HEARTBEAT_WATCHDOG_MS = 20_000
// On wake-up, treat the connection as stale if last heartbeat was > this long ago
// (mobile browsers freeze SSE while backgrounded — we can't trust the existing socket)
const STALE_AFTER_MS = 12_000
// Stop reconnecting after this many consecutive failures without a successful connection
const MAX_INITIAL_FAILURES = 5

class EventBus {
  private es: EventSource | null = null
  private handlers = new Map<string, Set<IssueEventHandler>>()
  private issueUpdatedListeners = new Set<IssueUpdatedListener>()
  private changesSummaryListeners = new Set<ChangesSummaryListener>()
  private issueActivityListeners = new Set<IssueActivityListener>()
  private connectionListeners = new Set<ConnectionListener>()
  private resumeListeners = new Set<ResumeListener>()
  private cockpitProposalListeners = new Set<CockpitProposalListener>()
  private cockpitResetListeners = new Set<CockpitResetListener>()
  private cockpitTimelineListeners = new Set<CockpitTimelineListener>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatWatchdog: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = BASE_RECONNECT_DELAY
  private connected = false
  private hasConnectedOnce = false
  private consecutiveFailures = 0
  private lastHeartbeatAt = 0
  private visibilityHandler: (() => void) | null = null

  connect(): void {
    if (this.es) return

    // Install visibility listener once — handles mobile browser freezing the
    // SSE socket while backgrounded. setTimeout-based watchdogs are throttled
    // or paused while hidden, so we can't rely on them to detect a dead socket
    // after wake-up. On visibility resume, treat the connection as suspect
    // and force-reconnect if we haven't seen a heartbeat recently.
    this.installVisibilityListener()

    const token = getToken()
    const sseUrl = token ? `/api/events?token=${encodeURIComponent(token)}` : '/api/events'
    const es = new EventSource(sseUrl)
    this.es = es

    es.onopen = () => {
      this.connected = true
      this.hasConnectedOnce = true
      this.consecutiveFailures = 0
      this.reconnectDelay = BASE_RECONNECT_DELAY
      this.lastHeartbeatAt = Date.now()
      this.notifyConnectionChange(true)
      this.resetHeartbeatWatchdog(es)
    }

    es.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          entry: NormalizedLogEntry
        }
        this.dispatch(data.issueId, h => h.onLog(data.entry))
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('log-updated', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          entry: NormalizedLogEntry
        }
        this.dispatch(data.issueId, h => h.onLogUpdated(data.entry))
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('log-removed', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          messageIds: string[]
        }
        this.dispatch(data.issueId, h => h.onLogRemoved(data.messageIds))
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('state', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          executionId: string
          state: SessionStatus
        }
        this.dispatch(data.issueId, h =>
          h.onState({ executionId: data.executionId, state: data.state }))
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore */
      }
    })

    es.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          executionId: string
          finalStatus: SessionStatus
        }
        this.dispatch(data.issueId, h => h.onDone({
          executionId: data.executionId,
          finalStatus: data.finalStatus,
        }))
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore */
      }
    })

    es.addEventListener('issue-updated', (e) => {
      try {
        const data = JSON.parse(e.data) as {
          issueId: string
          changes: Record<string, unknown>
          title?: string
          projectAlias?: string
          source?: string
        }
        for (const cb of this.issueUpdatedListeners) {
          try {
            cb(data)
          } catch {
            /* ignore */
          }
        }
        this.notifyActivity(data.issueId)
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('changes-summary', (e) => {
      try {
        const data = JSON.parse(e.data) as ChangesSummaryData
        for (const cb of this.changesSummaryListeners) {
          try {
            cb(data)
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('cockpit-proposal', (e) => {
      try {
        const data = JSON.parse(e.data) as Parameters<CockpitProposalListener>[0]
        for (const cb of this.cockpitProposalListeners) {
          try {
            cb(data)
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('cockpit-timeline', (e) => {
      try {
        const data = JSON.parse(e.data) as CockpitTimelineDelta
        for (const cb of this.cockpitTimelineListeners) {
          try {
            cb(data)
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore parse errors */
      }
    })

    es.addEventListener('cockpit-reset', (e) => {
      try {
        const data = JSON.parse(e.data) as Parameters<CockpitResetListener>[0]
        for (const cb of this.cockpitResetListeners) {
          try {
            cb(data)
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore parse errors */
      }
    })

    // Reset watchdog on heartbeat — server sends every 15s
    es.addEventListener('heartbeat', () => {
      this.lastHeartbeatAt = Date.now()
      this.resetHeartbeatWatchdog(es)
    })

    es.onerror = () => {
      this.clearHeartbeatWatchdog()
      es.close()
      this.es = null
      this.connected = false
      this.notifyConnectionChange(false)

      this.consecutiveFailures++

      // Before first successful connection: stop after repeated failures
      // (likely auth rejection — caller must re-invoke connect() when auth state changes)
      if (!this.hasConnectedOnce && this.consecutiveFailures >= MAX_INITIAL_FAILURES) {
        return
      }

      // Before first successful connection: fast fixed-interval retry
      // After first connection: exponential backoff for reconnections
      const delay = this.hasConnectedOnce ? this.reconnectDelay : INITIAL_RETRY_DELAY
      if (this.hasConnectedOnce) {
        this.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY)
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect()
      }, delay)
    }
  }

  disconnect(): void {
    this.clearHeartbeatWatchdog()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.es) {
      this.es.close()
      this.es = null
    }
    this.connected = false
    this.hasConnectedOnce = false
    this.consecutiveFailures = 0
    this.reconnectDelay = BASE_RECONNECT_DELAY
    this.notifyConnectionChange(false)
    this.removeVisibilityListener()
  }

  /**
   * Tear down the current SSE socket (if any) and reconnect immediately.
   * Used by the visibility-change handler when waking from background, where
   * the existing EventSource may be silently dead because mobile browsers
   * froze the network stack.
   */
  forceReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearHeartbeatWatchdog()
    if (this.es) {
      try {
        this.es.close()
      } catch {
        /* ignore */
      }
      this.es = null
    }
    this.connected = false
    this.notifyConnectionChange(false)
    this.reconnectDelay = BASE_RECONNECT_DELAY
    this.connect()
    this.notifyResumed()
  }

  subscribe(issueId: string, handler: IssueEventHandler): () => void {
    let set = this.handlers.get(issueId)
    if (!set) {
      set = new Set()
      this.handlers.set(issueId, set)
    }
    set.add(handler)

    return () => {
      set.delete(handler)
      if (set.size === 0) {
        this.handlers.delete(issueId)
      }
    }
  }

  onIssueActivity(listener: IssueActivityListener): () => void {
    this.issueActivityListeners.add(listener)
    return () => {
      this.issueActivityListeners.delete(listener)
    }
  }

  onIssueUpdated(listener: IssueUpdatedListener): () => void {
    this.issueUpdatedListeners.add(listener)
    return () => {
      this.issueUpdatedListeners.delete(listener)
    }
  }

  onChangesSummary(listener: ChangesSummaryListener): () => void {
    this.changesSummaryListeners.add(listener)
    return () => {
      this.changesSummaryListeners.delete(listener)
    }
  }

  onCockpitProposal(listener: CockpitProposalListener): () => void {
    this.cockpitProposalListeners.add(listener)
    return () => {
      this.cockpitProposalListeners.delete(listener)
    }
  }

  onCockpitReset(listener: CockpitResetListener): () => void {
    this.cockpitResetListeners.add(listener)
    return () => {
      this.cockpitResetListeners.delete(listener)
    }
  }

  onCockpitTimeline(listener: CockpitTimelineListener): () => void {
    this.cockpitTimelineListeners.add(listener)
    return () => {
      this.cockpitTimelineListeners.delete(listener)
    }
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener)
    // Immediately notify with current state
    listener(this.connected)
    return () => {
      this.connectionListeners.delete(listener)
    }
  }

  /**
   * Subscribe to "the page just woke up from background" events.
   * Listeners can use this to refetch state that may have drifted while the
   * SSE connection was frozen — e.g. historical log pages that missed events.
   */
  onResume(listener: ResumeListener): () => void {
    this.resumeListeners.add(listener)
    return () => {
      this.resumeListeners.delete(listener)
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  private dispatch(issueId: string, fn: (handler: IssueEventHandler) => void): void {
    const set = this.handlers.get(issueId)
    if (!set) return
    for (const handler of set) {
      try {
        fn(handler)
      } catch {
        /* ignore handler errors */
      }
    }
  }

  private resetHeartbeatWatchdog(es: EventSource): void {
    this.clearHeartbeatWatchdog()
    this.heartbeatWatchdog = setTimeout(() => {
      // No heartbeat received — connection is likely stale, force reconnect
      this.heartbeatWatchdog = null
      es.close()
      this.es = null
      this.connected = false
      this.notifyConnectionChange(false)
      this.reconnectDelay = BASE_RECONNECT_DELAY
      this.connect()
    }, HEARTBEAT_WATCHDOG_MS)
  }

  private clearHeartbeatWatchdog(): void {
    if (this.heartbeatWatchdog) {
      clearTimeout(this.heartbeatWatchdog)
      this.heartbeatWatchdog = null
    }
  }

  private notifyActivity(issueId: string): void {
    for (const listener of this.issueActivityListeners) {
      try {
        listener(issueId)
      } catch {
        /* ignore */
      }
    }
  }

  private notifyConnectionChange(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(connected)
      } catch {
        /* ignore */
      }
    }
  }

  private notifyResumed(): void {
    for (const listener of this.resumeListeners) {
      try {
        listener()
      } catch {
        /* ignore */
      }
    }
  }

  private installVisibilityListener(): void {
    if (this.visibilityHandler || typeof document === 'undefined') return
    this.visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return
      // The page is visible again. The SSE socket may be silently dead from
      // having been frozen while backgrounded. If we lost the connection, OR
      // the last heartbeat was too long ago, force a fresh reconnect and tell
      // subscribers to refetch any state that may have drifted.
      const stale =
        !this.es ||
        !this.connected ||
        Date.now() - this.lastHeartbeatAt > STALE_AFTER_MS
      if (stale) {
        this.forceReconnect()
      }
    }
    document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  private removeVisibilityListener(): void {
    if (!this.visibilityHandler || typeof document === 'undefined') return
    document.removeEventListener('visibilitychange', this.visibilityHandler)
    this.visibilityHandler = null
  }
}

export const eventBus = new EventBus()
