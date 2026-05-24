import { createOpenAPIRouter } from '@/openapi/hono'
import { subscribeTimeline } from '@/cockpit/timeline'
import { isVisible } from '@/engines/issue/utils/visibility'
import { appEvents } from '@/events'
import { logger } from '@/logger'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

const events = createOpenAPIRouter()

// GET /api/events — Global SSE stream
// Broadcasts all issue events. Client-side filtering by project/issue.
events.get('/', (c) => {
  logger.debug('global_sse_open')

  const encoder = new TextEncoder()
  let done = false
  let cleanup: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const writeEvent = (event: string, data: unknown) => {
        if (done) return
        try {
          controller.enqueue(encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ))
        } catch {
          stop()
        }
      }

      const stop = () => {
        if (done) return
        done = true
        try {
          controller.close()
        } catch { /* already closed */ }
      }

      c.req.raw.signal.addEventListener('abort', stop)

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
        writeEvent('log-updated', data)
      })

      const unsubLogRemoved = appEvents.on('log-removed', (data) => {
        writeEvent('log-removed', data)
      })

      // Non-terminal state changes
      const unsubState = appEvents.on('state', (data) => {
        if (TERMINAL.has(data.state)) return
        writeEvent('state', {
          issueId: data.issueId,
          executionId: data.executionId,
          state: data.state,
        })
      })

      // Terminal state
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

      const unsubIssueUpdated = appEvents.on('issue-updated', (data) => {
        writeEvent('issue-updated', data)
      })

      const unsubChangesSummary = appEvents.on('changes-summary', (data) => {
        writeEvent('changes-summary', data)
      })

      const unsubCockpitProposal = appEvents.on('cockpit-proposal', (data) => {
        writeEvent('cockpit-proposal', data)
      })

      const unsubCockpitReset = appEvents.on('cockpit-reset', (data) => {
        writeEvent('cockpit-reset', data)
      })

      const unsubCockpitTimeline = subscribeTimeline((delta) => {
        writeEvent('cockpit-timeline', delta)
      })

      // Heartbeat every 8s
      const heartbeat = setInterval(() => {
        if (done) return
        writeEvent('heartbeat', { ts: new Date().toISOString() })
      }, 8_000)

      cleanup = () => {
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
        unsubCockpitTimeline()
        logger.debug('global_sse_closed')
        stop()
      }
    },
    cancel() {
      cleanup?.()
    },
  })

  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')
  return c.newResponse(stream)
})

export default events
