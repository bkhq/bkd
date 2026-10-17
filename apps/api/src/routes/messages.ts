import type { DecisionEventOption, MessageStatus } from '@bkd/shared'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { messages } from '@/db/schema'
import type { AnswerResult, MessageRow } from '@/messages/service'
import {
  answeredStatus,
  decideMessage,
  emitMessageUpdated,
  findMessage,
  findSourceIssue,
  hasOption,
  insertMessage,
  markRead,
  replyMessage,
  serializeMessage,
  serializeMessages,
  takeSendSlot,
  transition,
  updateFrom,
  wakeSource,
} from '@/messages/service'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const messagesRoutes = createOpenAPIRouter()

const NOT_FOUND = { success: false as const, error: 'Message not found' }

function conflict(status: string) {
  return { success: false as const, error: `Not allowed while the message is ${status}` }
}

function badRequest(error: string) {
  return { success: false as const, error }
}

/** Statuses from which an action may move a message awaiting a reply. */
function replyFlowFrom(row: MessageRow, action: 'ack' | 'withdraw' | 'close' | 'notify'): MessageStatus[] {
  const answered = answeredStatus(row)
  if (action === 'withdraw') return ['open']
  if (action === 'close') return ['open', answered]
  return [answered]
}

// GET /api/messages
messagesRoutes.openapi(R.getMessageCapability, (c) => {
  return c.json({
    success: true as const,
    data: { supported: true as const, contractVersion: 2, kinds: ['decision' as const, 'notification' as const] },
  })
})

// GET /api/messages/items
messagesRoutes.openapi(R.listMessages, async (c) => {
  const { kind, expects, status, campaignId, issueId } = c.req.valid('query')
  const rows = await db
    .select()
    .from(messages)
    .where(and(
      eq(messages.isDeleted, 0),
      kind ? eq(messages.kind, kind) : undefined,
      expects ? eq(messages.expects, expects) : undefined,
      status ? inArray(messages.status, status.split(',')) : undefined,
      campaignId ? eq(messages.campaignId, campaignId) : undefined,
      issueId ? sql`json_extract(${messages.source}, '$.issueId') = ${issueId}` : undefined,
    ))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(500)
  return c.json({ success: true as const, data: await serializeMessages(rows) }, 200)
})

// POST /api/messages/items
messagesRoutes.openapi(R.createMessage, async (c) => {
  const body = c.req.valid('json')
  if (body.kind === 'notification' && body.expects === 'reply' && !body.source) {
    return c.json(badRequest('source is required when expects is reply'), 400)
  }
  if (body.kind === 'decision' && body.recommendation && !hasOption(body.options, body.recommendation.optionId)) {
    return c.json(badRequest('recommendation.optionId is not one of the options'), 400)
  }
  if (body.source && !(await findSourceIssue(body.source))) {
    return c.json(badRequest('source issue not found in source project'), 400)
  }
  if (body.kind === 'notification' && !takeSendSlot(body.source?.issueId ?? '')) {
    return c.json({ success: false as const, error: 'Too many notifications from this issue; try again in a minute' }, 429)
  }

  const common = {
    ref: body.ref ?? null,
    title: body.title,
    body: body.body,
    source: body.source ? JSON.stringify({ projectId: body.source.projectId, issueId: body.source.issueId }) : null,
  }
  const row = body.kind === 'decision'
    ? await insertMessage({
        ...common,
        kind: 'decision',
        expects: 'reply',
        status: 'open',
        campaignId: body.campaignId,
        options: JSON.stringify(body.options),
        recommendation: body.recommendation ? JSON.stringify(body.recommendation) : null,
        blocks: body.blocks ?? null,
        continues: body.continues ?? null,
      })
    : await insertMessage({
        ...common,
        kind: 'notification',
        expects: body.expects,
        status: body.expects === 'reply' ? 'open' : 'unread',
        level: body.level,
        campaignId: body.campaignId ?? null,
      })
  return c.json({ success: true as const, data: await serializeMessage(row) }, 201)
})

// POST /api/messages/items/read
messagesRoutes.openapi(R.markMessagesRead, async (c) => {
  const { ids } = c.req.valid('json')
  const rows = await markRead(ids)
  return c.json({ success: true as const, data: { ids: rows.map(r => r.id) } }, 200)
})

// GET /api/messages/items/:messageId
messagesRoutes.openapi(R.getMessage, async (c) => {
  const row = await findMessage(c.req.valid('param').messageId)
  if (!row) return c.json(NOT_FOUND, 404)
  return c.json({ success: true as const, data: await serializeMessage(row) }, 200)
})

// PATCH /api/messages/items/:messageId
messagesRoutes.openapi(R.updateMessage, async (c) => {
  const { messageId } = c.req.valid('param')
  const body = c.req.valid('json')
  const existing = await findMessage(messageId)
  if (!existing) return c.json(NOT_FOUND, 404)
  if (existing.expects !== 'reply') return c.json(conflict('not awaiting a reply'), 409)
  if (existing.status !== 'open') return c.json(conflict(existing.status), 409)

  const isDecision = existing.kind === 'decision'
  const decisionOnly = [body.options, body.recommendation, body.blocks, body.continues]
  if (!isDecision && decisionOnly.some(v => v !== undefined)) {
    return c.json(badRequest('options, recommendation, blocks and continues apply to decisions only'), 400)
  }
  if (isDecision && body.level !== undefined) return c.json(badRequest('level applies to notifications only'), 400)

  const options = body.options ?? (JSON.parse(existing.options) as DecisionEventOption[])
  const recommendation = body.recommendation === undefined
    ? (existing.recommendation ? JSON.parse(existing.recommendation) as { optionId: string } : null)
    : body.recommendation
  if (recommendation && !hasOption(options, recommendation.optionId)) {
    return c.json(badRequest('recommendation.optionId is not one of the options'), 400)
  }

  const row = await updateFrom(messageId, ['open'], {
    ...(body.ref !== undefined && { ref: body.ref }),
    ...(body.title !== undefined && { title: body.title }),
    ...(body.body !== undefined && { body: body.body }),
    ...(body.level !== undefined && { level: body.level }),
    ...(body.options !== undefined && { options: JSON.stringify(body.options) }),
    ...(body.recommendation !== undefined && {
      recommendation: body.recommendation ? JSON.stringify(body.recommendation) : null,
    }),
    ...(body.blocks !== undefined && { blocks: body.blocks }),
    ...(body.continues !== undefined && { continues: body.continues }),
  })
  if (!row) return c.json(conflict('no longer open'), 409)
  return c.json({ success: true as const, data: await serializeMessage(row) }, 200)
})

function answerResponse(result: AnswerResult) {
  if (result.ok) return null
  if (result.reason === 'not-found') return { body: NOT_FOUND, status: 404 as const }
  if (result.reason === 'bad-option') return { body: badRequest('optionId is not one of the options'), status: 400 as const }
  return { body: conflict(result.status), status: 409 as const }
}

// POST /api/messages/items/:messageId/decision
messagesRoutes.openapi(R.decideMessage, async (c) => {
  const body = c.req.valid('json')
  const result = await decideMessage(c.req.valid('param').messageId, {
    optionId: body.optionId ?? null,
    instruction: body.instruction,
    decidedBy: body.decidedBy,
  })
  if (result.ok) return c.json({ success: true as const, data: await serializeMessage(result.row) }, 200)
  const error = answerResponse(result)!
  return c.json(error.body, error.status)
})

// POST /api/messages/items/:messageId/reply
messagesRoutes.openapi(R.replyMessage, async (c) => {
  const body = c.req.valid('json')
  const result = await replyMessage(c.req.valid('param').messageId, { text: body.text, repliedBy: body.repliedBy })
  if (result.ok) return c.json({ success: true as const, data: await serializeMessage(result.row) }, 200)
  const error = answerResponse(result)!
  return c.json(error.body, error.status)
})

// POST /api/messages/items/:messageId/notify
messagesRoutes.openapi(R.notifyMessage, async (c) => {
  const existing = await findMessage(c.req.valid('param').messageId)
  if (!existing) return c.json(NOT_FOUND, 404)
  if (existing.expects !== 'reply') return c.json(conflict('not awaiting a reply'), 409)
  if (!replyFlowFrom(existing, 'notify').includes(existing.status as MessageStatus)) {
    return c.json(conflict(existing.status), 409)
  }

  const notified = await wakeSource(existing)
  if (!notified) return c.json(badRequest('Follow-up could not be delivered'), 502)
  emitMessageUpdated(notified)
  return c.json({ success: true as const, data: await serializeMessage(notified) }, 200)
})

/** Run a reply-flow transition, answering 404/409 the same way for every action. */
async function replyFlowTransition(
  messageId: string,
  action: 'ack' | 'withdraw' | 'close',
  set: Parameters<typeof transition>[2],
): Promise<{ row: MessageRow } | { error: { success: false, error: string }, status: 404 | 409 }> {
  const existing = await findMessage(messageId)
  if (!existing) return { error: NOT_FOUND, status: 404 as const }
  if (existing.expects !== 'reply') return { error: conflict('not awaiting a reply'), status: 409 as const }
  const result = await transition(messageId, replyFlowFrom(existing, action), set)
  if ('row' in result) return { row: result.row }
  if (result.blockedBy === null) return { error: NOT_FOUND, status: 404 as const }
  return { error: conflict(result.blockedBy), status: 409 as const }
}

// POST /api/messages/items/:messageId/ack
messagesRoutes.openapi(R.ackMessage, async (c) => {
  const { outcome } = c.req.valid('json')
  const result = await replyFlowTransition(c.req.valid('param').messageId, 'ack', { status: 'applied', outcome })
  if ('row' in result) return c.json({ success: true as const, data: await serializeMessage(result.row) }, 200)
  return c.json(result.error, result.status)
})

// POST /api/messages/items/:messageId/withdraw
messagesRoutes.openapi(R.withdrawMessage, async (c) => {
  const { reason } = c.req.valid('json')
  const result = await replyFlowTransition(c.req.valid('param').messageId, 'withdraw', {
    status: 'withdrawn',
    withdrawReason: reason,
  })
  if ('row' in result) return c.json({ success: true as const, data: await serializeMessage(result.row) }, 200)
  return c.json(result.error, result.status)
})

// POST /api/messages/items/:messageId/close
messagesRoutes.openapi(R.closeMessage, async (c) => {
  const { reason } = c.req.valid('json')
  const result = await replyFlowTransition(c.req.valid('param').messageId, 'close', {
    status: 'closed',
    closeReason: reason || null,
  })
  if ('row' in result) return c.json({ success: true as const, data: await serializeMessage(result.row) }, 200)
  return c.json(result.error, result.status)
})

// POST /api/messages/items/:messageId/read
messagesRoutes.openapi(R.readMessage, async (c) => {
  const { messageId } = c.req.valid('param')
  const existing = await findMessage(messageId)
  if (!existing) return c.json(NOT_FOUND, 404)
  if (existing.expects !== 'none') return c.json(conflict('awaiting a reply'), 409)
  await markRead([messageId])
  return c.json({ success: true as const, data: await serializeMessage((await findMessage(messageId))!) }, 200)
})

export default messagesRoutes
