import { SystemLogsSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import * as z from 'zod'
import { createRoute } from '@hono/zod-openapi'
import { existsSync } from 'node:fs'
import { stat, truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { createOpenAPIRouter } from '@/openapi/hono'
import { DATA_DIR } from '@/root'

const systemLogs = createOpenAPIRouter()

const LOG_FILE = join(DATA_DIR, 'logs', 'bkd.log')

// GET /api/settings/system-logs — tail the log file
systemLogs.openapi(createRoute({
  method: 'get',
  path: '/system-logs',
  tags: ['Settings'],
  operationId: 'getSettingsSystemLogsSystemLogs',
  request: { query: z.object({ lines: z.coerce.number().int().min(1).max(5000).default(200) }) },
  responses: {
    200: successResponse(SystemLogsSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const lines = Number(c.req.query('lines') ?? '200')
  const clampedLines = Math.min(Math.max(lines, 1), 5000)

  if (!existsSync(LOG_FILE)) {
    return c.json({ success: true as const, data: { lines: [], fileSize: 0 } }, 200)
  }

  const s = await stat(LOG_FILE).catch(() => null)
  const fileSize = s?.size ?? 0

  // Read last N lines efficiently: for large files, read only the tail
  const MAX_TAIL_BYTES = 512 * 1024 // 512 KB max read for tail
  const file = Bun.file(LOG_FILE)

  let content: string
  if (fileSize > MAX_TAIL_BYTES) {
    // Read only the last chunk — may cut the first line, which we discard
    const fd = await Bun.file(LOG_FILE).slice(fileSize - MAX_TAIL_BYTES)
    content = await fd.text()
    // Discard partial first line
    const firstNewline = content.indexOf('\n')
    if (firstNewline !== -1) content = content.slice(firstNewline + 1)
  } else {
    content = await file.text()
  }

  const allLines = content.split('\n').filter(l => l.length > 0)
  const tailLines = allLines.slice(-clampedLines)

  // For totalLines, estimate from file size if we only read a chunk
  const totalLines =
    fileSize > MAX_TAIL_BYTES ?
        Math.round((fileSize / MAX_TAIL_BYTES) * allLines.length) :
      allLines.length

  return c.json({
    success: true as const,
    data: { lines: tailLines, fileSize, totalLines },
  }, 200)
})

// GET /api/settings/system-logs/download — download the full log file
systemLogs.openapi(createRoute({
  method: 'get',
  path: '/system-logs/download',
  tags: ['Settings'],
  operationId: 'getSettingsSystemLogsSystemLogsDownload',
  responses: {
    200: { description: 'Log download', content: { 'text/plain': { schema: z.string() } } },
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  if (!existsSync(LOG_FILE)) {
    return c.json({ success: false as const, error: 'Log file not found' }, 404)
  }

  const file = Bun.file(LOG_FILE)
  c.header('Content-Type', 'text/plain; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="bkd.log"')
  return c.text(await file.text(), 200)
})

// POST /api/settings/system-logs/clear — truncate the log file
systemLogs.openapi(createRoute({
  method: 'post',
  path: '/system-logs/clear',
  tags: ['Settings'],
  operationId: 'postSettingsSystemLogsSystemLogsClear',
  responses: {
    200: successResponse(z.object({ cleared: z.boolean() }), 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  if (!existsSync(LOG_FILE)) {
    return c.json({ success: true as const, data: { cleared: true } }, 200)
  }

  await truncate(LOG_FILE, 0)
  return c.json({ success: true as const, data: { cleared: true } }, 200)
})

export default systemLogs
