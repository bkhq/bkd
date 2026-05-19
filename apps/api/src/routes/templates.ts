import * as z from 'zod'
import { zValidator } from '@hono/zod-validator'
import { issueTemplateSchema, listTemplates, saveUserTemplates } from '@/cockpit/templates'
import { createOpenAPIRouter } from '@/openapi/hono'

const templates = createOpenAPIRouter()

templates.get('/', async (c) => {
  const data = await listTemplates()
  return c.json({ success: true, data })
})

const putSchema = z.object({
  templates: z.array(issueTemplateSchema).max(50),
})

templates.put('/', zValidator('json', putSchema), async (c) => {
  const { templates: items } = c.req.valid('json')
  // Ensure unique ids
  const seen = new Set<string>()
  for (const t of items) {
    if (seen.has(t.id)) {
      return c.json({ success: false, error: `Duplicate template id: ${t.id}` }, 400)
    }
    seen.add(t.id)
  }
  const count = await saveUserTemplates(items)
  return c.json({ success: true, data: { count } })
})

export default templates
