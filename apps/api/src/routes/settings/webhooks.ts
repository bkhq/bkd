import type { NotificationChannel, WebhookEventType } from '@bkd/shared'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { webhookDeliveries, webhooks } from '@/db/schema'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { validateWebhookUrl } from '@/utils/url-safety'
import { deliver } from '@/webhooks/dispatcher'

const webhooksRoute = createOpenAPIRouter()

const SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'

function serializeWebhook(row: typeof webhooks.$inferSelect) {
  let events: WebhookEventType[] = []
  try {
    events = JSON.parse(row.events) as WebhookEventType[]
  } catch {
    events = []
  }

  return {
    id: row.id,
    channel: row.channel as NotificationChannel,
    url: row.url,
    secret: row.secret ? SECRET_MASK : null,
    events,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// GET /api/settings/webhooks
webhooksRoute.openapi(R.listWebhooks, async (c) => {
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.isDeleted, 0))
    .orderBy(desc(webhooks.createdAt))

  return c.json({ success: true, data: rows.map(serializeWebhook) })
})

// POST /api/settings/webhooks
webhooksRoute.openapi(R.createWebhook, async (c) => {
  const body = c.req.valid('json')

  // Channel-specific validation (moved from superRefine)
  const channel = body.channel ?? 'webhook'
  if (channel === 'webhook') {
    // Synchronous format checks
    try {
      const parsed = new URL(body.url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return c.json({ success: false, error: 'URL must use http or https protocol' }, 400)
      }
    } catch {
      return c.json({ success: false, error: 'Invalid URL format' }, 400)
    }

    // Async SSRF check — resolve DNS and reject private addresses
    const result = await validateWebhookUrl(body.url)
    if (!result.ok) {
      return c.json({ success: false, error: result.error }, 400)
    }
  } else if (channel === 'telegram') {
    if (!body.secret || body.secret.trim().length === 0) {
      return c.json({ success: false, error: 'Bot token is required for Telegram' }, 400)
    }
    if (!/^-?\d+$/.test(body.url.trim())) {
      return c.json({ success: false, error: 'Chat ID must be a numeric value' }, 400)
    }
  }

  const [row] = await db
    .insert(webhooks)
    .values({
      channel: body.channel ?? 'webhook',
      url: body.url,
      secret: body.secret ?? null,
      events: JSON.stringify(body.events),
      isActive: body.isActive ?? true,
    })
    .returning()

  return c.json({ success: true, data: serializeWebhook(row!) }, 201)
})

// PATCH /api/settings/webhooks/:webhookId
webhooksRoute.openapi(R.updateWebhook, async (c) => {
  const webhookId = c.req.param('webhookId')!
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.isDeleted, 0)))

  if (!existing) {
    return c.json({ success: false, error: 'Webhook not found' }, 404)
  }

  const body = c.req.valid('json')

  // Validate channel-specific rules against effective (merged) values
  // Channel is immutable after creation — always use existing value
  const effectiveChannel = existing.channel
  const effectiveUrl = body.url ?? existing.url
  const effectiveSecret =
    body.secret !== undefined && body.secret !== SECRET_MASK ? body.secret : existing.secret

  if (effectiveChannel === 'webhook' && body.url !== undefined) {
    const result = await validateWebhookUrl(effectiveUrl)
    if (!result.ok) {
      return c.json({ success: false, error: result.error }, 400)
    }
  }
  if (effectiveChannel === 'telegram') {
    if (!effectiveSecret) {
      return c.json({ success: false, error: 'Bot token is required for Telegram' }, 400)
    }
    if (body.url !== undefined && !/^-?\d+$/.test(effectiveUrl.trim())) {
      return c.json({ success: false, error: 'Chat ID must be a numeric value' }, 400)
    }
  }

  const updates: Record<string, unknown> = {}

  if (body.url !== undefined) updates.url = body.url
  // Skip masked secret (means "unchanged"); null means "clear"; otherwise set new value
  if (body.secret !== undefined && body.secret !== SECRET_MASK) {
    updates.secret = body.secret
  }
  if (body.events !== undefined) updates.events = JSON.stringify(body.events)
  if (body.isActive !== undefined) updates.isActive = body.isActive

  if (Object.keys(updates).length === 0) {
    return c.json({ success: true, data: serializeWebhook(existing) })
  }

  const [updated] = await db.update(webhooks).set(updates).where(eq(webhooks.id, webhookId)).returning()

  return c.json({ success: true, data: serializeWebhook(updated!) })
})

// DELETE /api/settings/webhooks/:webhookId
webhooksRoute.openapi(R.deleteWebhook, async (c) => {
  const webhookId = c.req.param('webhookId')!
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.isDeleted, 0)))

  if (!existing) {
    return c.json({ success: false, error: 'Webhook not found' }, 404)
  }

  await db.update(webhooks).set({ isDeleted: 1 }).where(eq(webhooks.id, webhookId))

  return c.json({ success: true, data: { id: webhookId } })
})

// GET /api/settings/webhooks/:webhookId/deliveries
webhooksRoute.openapi(R.getWebhookDeliveries, async (c) => {
  const webhookId = c.req.param('webhookId')!
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.isDeleted, 0)))

  if (!existing) {
    return c.json({ success: false, error: 'Webhook not found' }, 404)
  }

  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50)

  return c.json({
    success: true,
    data: rows.map(r => ({
      id: r.id,
      webhookId: r.webhookId,
      event: r.event,
      payload: r.payload,
      statusCode: r.statusCode,
      response: r.response,
      success: r.success,
      duration: r.duration,
      createdAt: r.createdAt.toISOString(),
    })),
  })
})

// POST /api/settings/webhooks/:webhookId/test — delivers only to the target webhook
webhooksRoute.openapi(R.testWebhook, async (c) => {
  const webhookId = c.req.param('webhookId')!
  const [existing] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), eq(webhooks.isDeleted, 0)))

  if (!existing) {
    return c.json({ success: false, error: 'Webhook not found' }, 404)
  }

  await deliver(
    {
      id: existing.id,
      channel: existing.channel,
      url: existing.url,
      secret: existing.secret,
      events: existing.events,
      isActive: existing.isActive,
    },
    'issue.updated',
    {
      event: 'issue.updated',
      issueId: 'test',
      changes: { title: 'Webhook test' },
      timestamp: new Date().toISOString(),
      test: true,
    },
  )

  return c.json({ success: true, data: { sent: true } })
})

export default webhooksRoute
