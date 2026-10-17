import type { DecisionEventOption } from '@bkd/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { messages } from '@/db/schema'
import {
  decideMessage,
  emitMessageUpdated,
  findMessage,
  findSourceIssue,
  hasOption,
  insertMessage,
  transition,
  updateFrom,
  wakeSource,
} from '@/messages/service'
import { serializeDecisionEvent as serializeEvent, serializeDecisionEvents as serializeEvents } from '@/messages/v1'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

// v1 decision-event contract, served from the messages store (kind 'decision').
const decisionsRoutes = createOpenAPIRouter()

const notDeleted = eq(messages.isDeleted, 0)
const isDecision = eq(messages.kind, 'decision')
const findEvent = (id: string) => findMessage(id, 'decision')
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
    .from(messages)
    .where(and(
      notDeleted,
      isDecision,
      campaignId ? eq(messages.campaignId, campaignId) : undefined,
      status ? inArray(messages.status, status.split(',')) : undefined,
    ))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(500)
  return c.json({ success: true as const, data: await serializeEvents(rows) }, 200)
})

// POST /api/decisions/events
decisionsRoutes.openapi(R.createDecisionEvent, async (c) => {
  const body = c.req.valid('json')
  if (body.recommendation && !hasOption(body.options, body.recommendation.optionId)) {
    return c.json({ success: false as const, error: 'recommendation.optionId is not one of the options' }, 400)
  }
  if (!(await findSourceIssue(body.notify))) {
    return c.json({ success: false as const, error: 'notify issue not found in notify project' }, 400)
  }

  const row = await insertMessage({
    kind: 'decision',
    expects: 'reply',
    status: 'open',
    campaignId: body.campaignId,
    ref: body.ref ?? null,
    title: body.question,
    body: body.context,
    options: JSON.stringify(body.options),
    recommendation: body.recommendation ? JSON.stringify(body.recommendation) : null,
    blocks: body.blocks ?? null,
    continues: body.continues ?? null,
    source: JSON.stringify(body.notify),
  })
  return c.json({ success: true as const, data: await serializeEvent(row) }, 201)
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
    ...(body.question !== undefined && { title: body.question }),
    ...(body.context !== undefined && { body: body.context }),
    ...(body.options !== undefined && { options: JSON.stringify(body.options) }),
    ...(body.recommendation !== undefined && {
      recommendation: body.recommendation ? JSON.stringify(body.recommendation) : null,
    }),
    ...(body.blocks !== undefined && { blocks: body.blocks }),
    ...(body.continues !== undefined && { continues: body.continues }),
  }, 'decision')
  if (!row) return c.json(conflict('no longer open'), 409)
  return c.json({ success: true as const, data: await serializeEvent(row) }, 200)
})

// POST /api/decisions/events/:eventId/decision
decisionsRoutes.openapi(R.decideDecisionEvent, async (c) => {
  const body = c.req.valid('json')
  const result = await decideMessage(c.req.valid('param').eventId, {
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

  const notified = await wakeSource(existing)
  if (!notified) {
    return c.json({ success: false as const, error: 'Follow-up could not be delivered' }, 502)
  }
  emitMessageUpdated(notified)
  return c.json({ success: true as const, data: await serializeEvent(notified) }, 200)
})

// POST /api/decisions/events/:eventId/ack
decisionsRoutes.openapi(R.ackDecisionEvent, async (c) => {
  const { outcome } = c.req.valid('json')
  const result = await transition(c.req.valid('param').eventId, ['decided'], { status: 'applied', outcome }, 'decision')
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
  }, 'decision')
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
  }, 'decision')
  if ('row' in result) return c.json({ success: true as const, data: await serializeEvent(result.row) }, 200)
  if (result.blockedBy === null) return c.json(NOT_FOUND, 404)
  return c.json(conflict(result.blockedBy), 409)
})

export default decisionsRoutes
