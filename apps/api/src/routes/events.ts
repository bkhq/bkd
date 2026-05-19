import { streamSSE } from 'hono/streaming'
import { createOpenAPIRouter } from '@/openapi/hono'
import { isVisible } from '@/engines/issue/utils/visibility'
import { appEvents } from '@/events'
import { logger } from '@/logger'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

const events = createOpenAPIRouter()

// GET /api/events — Global SSE stream
// Broadcasts all issue events. Client-side filtering by project/issue.
events.get('/', async (c) => {
  logger.debug('global_sse_open')

  try {
    return streamSSE(c, async (stream) => {
      let done = false
      let resolveDone: (() => void) | undefined
      const donePromise = new Promise<void>((r) => {
        resolveDone = r
      })

      const stop = () => {
        if (!done) {
          done = true
          resolveDone?.()
        }
      }

      // Detect client disconnect immediately via AbortSignal
      c.req.raw.signal.addEventListener('abort', stop)

      const writeEvent = (event: string, data: unknown) => {
        if (done) return
        stream.writeSSE({ event, data: JSON.stringify(data) }).catch(stop)
      }

      // Subscribe to 'timeline-entry' — already converted by the pipeline
      // stage at order 90, exactly once per emit regardless of how many
      // SSE clients are connected. We just forward the wire.
      const unsubLog = appEvents.on(
        'timeline-entry',
        (data) => {
          writeEvent('log', { issueId: data.issueId, entry: data.entry })
        },
      )

      const unsubLogUpdated = appEvents.on('log-updated', (data) => {
        if (!isVisible(data.entry)) return
        // log-updated is rare (used for retroactive entry updates) — pass the
        // raw entry as-is. Clients still upsert by id.
        writeEvent('log-updated', data)
      })

      const unsubLogRemoved = appEvents.on('log-removed', (data) => {
        writeEvent('log-removed', data)
      })

      // Non-terminal state changes
      const unsubState = appEvents.on('state', (data) => {
        if (TERMINAL.has(data.state)) return // handled by 'done' below
        writeEvent('state', {
          issueId: data.issueId,
          executionId: data.executionId,
          state: data.state,
        })
      })

      // Terminal state — converter flush already happened in settleIssue()
      // (lifecycle/settle.ts) before this event was emitted, so any tail
      // 'timeline-entry' events have already been delivered to subscribers.
      const unsubDone = appEvents.on('done', (data) => {
        writeEvent('state', {
          issueId: data.issueId,
          executionId: data.executionId,
          state: data.finalStatus,
        })
        writeEvent('done', {
          issueId: data.issueId,
          executionId: data.executionId,
          finalStatus: data.finalStatus,
        })
      })

      // Issue data mutations (status changes, etc.)
      const unsubIssueUpdated = appEvents.on('issue-updated', (data) => {
        writeEvent('issue-updated', data)
      })

      // Changes summary (file count + line stats)
      const unsubChangesSummary = appEvents.on('changes-summary', (data) => {
        writeEvent('changes-summary', data)
      })

      // Cockpit proposals: new / approved / rejected / failed
      const unsubCockpitProposal = appEvents.on('cockpit-proposal', (data) => {
        writeEvent('cockpit-proposal', data)
      })

      // Cockpit assistant session reset
      const unsubCockpitReset = appEvents.on('cockpit-reset', (data) => {
        writeEvent('cockpit-reset', data)
      })

      // Heartbeat every 15s — keeps connection alive and detects client disconnect
      const heartbeat = setInterval(() => {
        if (done) return
        writeEvent('heartbeat', { ts: new Date().toISOString() })
      }, 15_000)

      // Wait until stream ends (client disconnect or write error)
      try {
        await donePromise
      } finally {
        clearInterval(heartbeat)
        unsubLog()
        unsubLogUpdated()
        unsubLogRemoved()
        unsubState()
        unsubDone()
        unsubIssueUpdated()
        unsubChangesSummary()
        unsubCockpitProposal()
        unsubCockpitReset()
        logger.debug('global_sse_closed')
      }
    })
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      },
      'global_sse_error',
    )
    return c.json({ success: false, error: 'Stream error' }, 500)
  }
})

export default events
