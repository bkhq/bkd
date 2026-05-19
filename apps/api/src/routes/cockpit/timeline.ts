import * as z from 'zod'
import { zValidator } from '@hono/zod-validator'
import {
  ack,
  bucketCounts,
  dismiss,
  listMessages,
  snooze,
} from '@/cockpit/timeline'
import { createOpenAPIRouter } from '@/openapi/hono'

const timeline = createOpenAPIRouter()

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.coerce.number().int().min(0).optional(),
})

timeline.get('/', zValidator('query', listQuery), async (c) => {
  const { limit, before } = c.req.valid('query')
  const [messages, counts] = await Promise.all([
    listMessages({ limit, beforeMs: before }),
    bucketCounts(),
  ])
  return c.json({ success: true, data: { messages, counts } })
})

timeline.post('/:id/ack', async (c) => {
  const id = c.req.param('id')
  const updated = await ack(id)
  if (!updated) return c.json({ success: false, error: 'Message not found' }, 404)
  return c.json({ success: true, data: updated })
})

timeline.post('/:id/dismiss', async (c) => {
  const id = c.req.param('id')
  const updated = await dismiss(id)
  if (!updated) return c.json({ success: false, error: 'Message not found' }, 404)
  return c.json({ success: true, data: updated })
})

const snoozeSchema = z.object({ untilMs: z.number().int().positive() })

timeline.post('/:id/snooze', zValidator('json', snoozeSchema), async (c) => {
  const id = c.req.param('id')
  const { untilMs } = c.req.valid('json')
  const updated = await snooze(id, untilMs)
  if (!updated) return c.json({ success: false, error: 'Message not found' }, 404)
  return c.json({ success: true, data: updated })
})

export default timeline
