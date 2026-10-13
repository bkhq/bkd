import type { DecisionEventOption, DecisionEventStatus } from '@bkd/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { decisionEvents } from '@/db/schema'
import type { DecisionEventRow } from '@/decisions/service'
import {
  emitDecisionEventUpdated,
  findNotifyIssue,
  notifyDecision,
  serializeEvent,
  serializeEvents,
} from '@/decisions/service'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const decisionsRoutes = createOpenAPIRouter()

const notDeleted = eq(decisionEvents.isDeleted, 0)
const NOT_FOUND = { success: false as const, error: 'Decision event not found' }

function conflict(status: string) {
  return { success: false as const, error: `Not allowed while the event is ${status}` }
}

async function findEvent(id: string): Promise<DecisionEventRow | null> {
  const [row] = await db.select().from(decisionEvents).where(and(eq(decisionEvents.id, id), notDeleted))
  return row ?? null
}

/** Update an event only while it is in one of `from`; null when it has moved on. */
async function updateFrom(
  id: string,
  from: DecisionEventStatus[],
  set: Partial<typeof decisionEvents.$inferInsert>,
): Promise<DecisionEventRow | null> {
  const [row] = await db
    .update(decisionEvents)
    .set(set)
    .where(and(eq(decisionEvents.id, id), notDeleted, inArray(decisionEvents.status, from)))
    .returning()
  if (row) emitDecisionEventUpdated(row)
  return row ?? null
}

function hasOption(options: DecisionEventOption[], optionId: string): boolean {
  return options.some(o => o.id === optionId)
}

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
  const { eventId } = c.req.valid('param')
  const body = c.req.valid('json')
  const existing = await findEvent(eventId)
  if (!existing) return c.json(NOT_FOUND, 404)
  if (existing.status !== 'open') return c.json(conflict(existing.status), 409)
  if (body.optionId && !hasOption(JSON.parse(existing.options), body.optionId)) {
    return c.json({ success: false as const, error: 'optionId is not one of the options' }, 400)
  }

  const decided = await updateFrom(eventId, ['open'], {
    status: 'decided',
    decision: JSON.stringify({
      optionId: body.optionId ?? null,
      instruction: body.instruction,
      decidedBy: body.decidedBy,
      decidedAt: new Date().toISOString(),
    }),
  })
  if (!decided) return c.json(conflict('no longer open'), 409)

  // The decision stands even when the wake signal fails; the raiser's scan picks it up.
  const notified = await notifyDecision(decided)
  return c.json({ success: true as const, data: await serializeEvent(notified ?? decided) }, 200)
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

/**
 * Move an event to another status. Returns the row, or the status that
 * blocked the move (null when the event does not exist).
 */
async function transition(
  eventId: string,
  from: DecisionEventStatus[],
  set: Partial<typeof decisionEvents.$inferInsert>,
): Promise<{ row: DecisionEventRow } | { blockedBy: string | null }> {
  const row = await updateFrom(eventId, from, set)
  if (row) return { row }
  return { blockedBy: (await findEvent(eventId))?.status ?? null }
}

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
