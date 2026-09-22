import { errorResponse } from '@/openapi/schemas'
import * as z from 'zod'
import { createRoute } from '@hono/zod-openapi'
import { resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { createOpenAPIRouter } from '@/openapi/hono'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { attachments } from '@/db/schema'
import { UPLOAD_DIR } from '@/uploads'
import { getProjectOwnedIssue } from './_shared'

const attachmentsRouter = createOpenAPIRouter()

/** Where uploads landed before UPLOAD_DIR moved off the process cwd onto DATA_DIR. */
const LEGACY_UPLOAD_DIR = resolve(process.cwd(), 'data/uploads')

/**
 * SEC-025: resolve `storedName` inside `base`, or null when it escapes the directory.
 */
function resolveInside(base: string, storedName: string): string | null {
  const path = resolve(base, storedName)
  return path.startsWith(`${base}/`) ? path : null
}

// GET /api/projects/:projectId/issues/:id/attachments/:attachmentId — Serve attachment file
attachmentsRouter.openapi(createRoute({
  method: 'get',
  path: '/{id}/attachments/{attachmentId}',
  tags: ['Issues'],
  operationId: 'getIssuesAttachmentsAttachments',
  request: { params: z.object({ projectId: z.string().min(1), id: z.string().min(1), attachmentId: z.string().min(1) }) },
  responses: {
    200: { description: 'File content', content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } } },
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false as const, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false as const, error: 'Issue not found' }, 404)
  }

  const attachmentId = c.req.param('attachmentId')!
  const [attachment] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId), eq(attachments.issueId, issueId)))
  if (!attachment) {
    return c.json({ success: false as const, error: 'Attachment not found' }, 404)
  }

  const primaryPath = resolveInside(UPLOAD_DIR, attachment.storedName)
  const legacyPath = resolveInside(LEGACY_UPLOAD_DIR, attachment.storedName)
  if (!primaryPath || !legacyPath) {
    return c.json({ success: false as const, error: 'Invalid attachment path' }, 400)
  }

  // Attachments written before UPLOAD_DIR moved onto DATA_DIR still live under the old cwd.
  let file = Bun.file(primaryPath)
  if (!(await file.exists())) {
    file = Bun.file(legacyPath)
    if (!(await file.exists())) {
      return c.json({ success: false as const, error: 'Attachment file missing' }, 404)
    }
  }

  return new Response(file.stream(), {
    headers: {
      'Content-Type': attachment.mimeType,
      // SEC-024: Force download to prevent content-sniffing and XSS via served files
      'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.originalName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    },
  })
})

export default attachmentsRouter
