import { createOpenAPIRouter } from '@/openapi/hono'
import { searchLogs } from '@/mcp/cockpit-tools'

const search = createOpenAPIRouter()

// GET /api/search/logs?q=...&limit=...
search.get('/logs', (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Math.min(Math.max(Number.parseInt(limitRaw, 10) || 30, 1), 200) : 30
  if (!q) return c.json({ success: false, error: 'query is required' }, 400)
  const hits = searchLogs(q, limit)
  return c.json({ success: true, data: hits })
})

export default search
