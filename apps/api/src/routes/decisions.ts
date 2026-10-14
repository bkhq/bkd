import type { DecisionEventOption } from '@bkd/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { decisionEvents } from '@/db/schema'
import {
  decideEvent,
  emitDecisionEventUpdated,
  findEvent,
  findNotifyIssue,
  hasOption,
  notifyDecision,
  serializeEvent,
  serializeEvents,
  transition,
  updateFrom,
} from '@/decisions/service'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const decisionsRoutes = createOpenAPIRouter()

const notDeleted = eq(decisionEvents.isDeleted, 0)
const NOT_FOUND = { success: false as const, error: 'Decision event not found' }

function conflict(status: string) {
  return { success: false as const, error: `Not allowed while the event is ${status}` }
}

// GET /api/decisions
decisionsRoutes.openapi(R.getDecisionCapability, (c) => {
  return c.json({ success: true as const, data: { supported: true as const, contractVersion: 1 } })
})

// GET /api/decisions/events
decisionsRoutes.openapi(R.listDecisionEvents, async (c) => {
  const { campaignId, status } = c.req.valid('query')
  const rows = await db
    .select()
    .from(decisionEvents)
    .where(and(
      notDeleted,
      campaignId ? eq(decisionEvents.campaignId, campaignId) : undefined,
      status ? inArray(decisionEvents.status, status.split(',')) : undefined,
    ))
    .orderBy(desc(decisionEvents.createdAt), desc(decisionEvents.id))
    .limit(500)
  return c.json({ success: true as const, data: await serializeEvents(rows) }, 200)
})

// POST /api/decisions/events
decisionsRoutes.openapi(R.createDecisionEvent, async (c) => {
  const body = c.req.valid('json')
  if (body.recommendation && !hasOption(body.options, body.recommendation.optionId)) {
    return c.json({ success: false as const, error: 'recommendation.optionId is not one of the options' }, 400)
  }
  if (!(await findNotifyIssue(body.notify))) {
    return c.json({ success: false as const, error: 'notify issue not found in notify project' }, 400)
  }

  const [row] = await db
    .insert(decisionEvents)
    .values({
      campaignId: body.campaignId,
      ref: body.ref ?? null,
      question: body.question,
      context: body.context,
      options: JSON.stringify(body.options),
      recommendation: body.recommendation ? JSON.stringify(body.recommendation) : null,
      blocks: body.blocks ?? null,
      continues: body.continues ?? null,
      notify: JSON.stringify(body.notify),
    })
    .returning()
  emitDecisionEventUpdated(row!)
  return c.json({ success: true as const, data: await serializeEvent(row!) }, 201)
})

// GET /api/decisions/events/:eventId
decisionsRoutes.openapi(R.getDecisionEvent, async (c) => {
  const row = await findEvent(c.req.valid('param').eventId)
  if (!row) return c.json(NOT_FOUND, 404)
  return c.json({ success: true as const, data: await serializeEvent(row) }, 200)
})

// PATCH /api/decisions/events/:eventId
decisionsRoutes.openapi(R.updateDecisionEvent, async (c) => {
  const { eventId } = c.req.valid('param')
  const body = c.req.valid('json')
  const existing = await findEvent(eventId)
  if (!existing) return c.json(NOT_FOUND, 404)
  if (existing.status !== 'open') return c.json(conflict(existing.status), 409)

  const options = body.options ?? (JSON.parse(existing.options) as DecisionEventOption[])
  const recommendation = body.recommendation === undefined
    ? (existing.recommendation ? JSON.parse(existing.recommendation) as { optionId: string } : null)
    : body.recommendation
  if (recommendation && !hasOption(options, recommendation.optionId)) {
    return c.json({ success: false as const, error: 'recommendation.optionId is not one of the options' }, 400)
  }

  const row = await updateFrom(eventId, ['open'], {
    ...(body.ref !== undefined && { ref: body.ref }),
    ...(body.question !== undefined && { question: body.question }),
    ...(body.context !== undefined && { context: body.context }),
    ...(body.options !== undefined && { options: JSON.stringify(body.options) }),
    ...(body.recommendation !== undefined && {
      recommendation: body.recommendation ? JSON.stringify(body.recommendation) : null,
    }),
    ...(body.blocks !== undefined && { blocks: body.blocks }),
    ...(body.continues !== undefined && { continues: body.continues }),
  })
  if (!row) return c.json(conflict('no longer open'), 409)
  return c.json({ success: true as const, data: await serializeEvent(row) }, 200)
})

// POST /api/decisions/events/:eventId/decision
decisionsRoutes.openapi(R.decideDecisionEvent, async (c) => {
  const body = c.req.valid('json')
  const result = await decideEvent(c.req.valid('param').eventId, {
    optionId: body.optionId ?? null,
    instruction: body.instruction,
    decidedBy: body.decidedBy,
  })
  if (result.ok) return c.json({ success: true as const, data: await serializeEvent(result.row) }, 200)
  if (result.reason === 'not-found') return c.json(NOT_FOUND, 404)
  if (result.reason === 'bad-option') {
    return c.json({ success: false as const, error: 'optionId is not one of the options' }, 400)
  }
  return c.json(conflict(result.status), 409)
})

// POST /api/decisions/events/:eventId/notify
decisionsRoutes.openapi(R.notifyDecisionEvent, async (c) => {
  const existing = await findEvent(c.req.valid('param').eventId)
  if (!existing) return c.json(NOT_FOUND, 404)
  if (existing.status !== 'decided') return c.json(conflict(existing.status), 409)

  const notified = await notifyDecision(existing)
  if (!notified) {
    return c.json({ success: false as const, error: 'Follow-up could not be delivered' }, 502)
  }
  emitDecisionEventUpdated(notified)
  return c.json({ success: true as const, data: await serializeEvent(notified) }, 200)
})

// POST /api/decisions/events/:eventId/ack
decisionsRoutes.openapi(R.ackDecisionEvent, async (c) => {
  const { outcome } = c.req.valid('json')
  const result = await transition(c.req.valid('param').eventId, ['decided'], { status: 'applied', outcome })
  if ('row' in result) return c.json({ success: true as const, data: await serializeEvent(result.row) }, 200)
  if (result.blockedBy === null) return c.json(NOT_FOUND, 404)
  return c.json(conflict(result.blockedBy), 409)
})

// POST /api/decisions/events/:eventId/withdraw
decisionsRoutes.openapi(R.withdrawDecisionEvent, async (c) => {
  const { reason } = c.req.valid('json')
  const result = await transition(c.req.valid('param').eventId, ['open'], {
    status: 'withdrawn',
    withdrawReason: reason,
  })
  if ('row' in result) return c.json({ success: true as const, data: await serializeEvent(result.row) }, 200)
  if (result.blockedBy === null) return c.json(NOT_FOUND, 404)
  return c.json(conflict(result.blockedBy), 409)
})

// POST /api/decisions/events/:eventId/close
decisionsRoutes.openapi(R.closeDecisionEvent, async (c) => {
  const { reason } = c.req.valid('json')
  const result = await transition(c.req.valid('param').eventId, ['open', 'decided'], {
    status: 'closed',
    closeReason: reason || null,
  })
  if ('row' in result) return c.json({ success: true as const, data: await serializeEvent(result.row) }, 200)
  if (result.blockedBy === null) return c.json(NOT_FOUND, 404)
  return c.json(conflict(result.blockedBy), 409)
})

export default decisionsRoutes
