import { HTTPException } from 'hono/http-exception'
import { PendingMessagesSchema, RecalledMessageSchema } from '@/openapi/extra-schemas'
import { AttachmentFollowUpSchema, errorResponse, FollowUpSchema, successResponse } from '@/openapi/schemas'
import { createRoute } from '@hono/zod-openapi'
import * as z from 'zod'
import { createOpenAPIRouter } from '@/openapi/hono'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { attachments } from '@/db/schema'
import { emitIssueLogRemoved } from '@/events/issue-events'
import type { SavedFile } from '@/uploads'
import { discardFiles, receiveAttachments, UploadError } from '@/uploads'
import { dispatchFollowUp, getProjectOwnedIssue, normalizePrompt } from './_shared'

// ---------- Private helpers ----------

/**
 * Build a prompt supplement describing uploaded files.
 */
function buildFileContext(savedFiles: SavedFile[]): string {
  if (savedFiles.length === 0) return ''
  const parts = savedFiles.map(
    f =>
      `[Attached file: ${f.originalName.replace(/[\r\n]/g, ' ').slice(0, 255)} at ${f.absolutePath.replace(/[\r\n]/g, '')}]`,
  )
  return `\n\n--- Attached files ---\n${parts.join('\n')}`
}

/**
 * Parse follow-up body from either JSON or multipart/form-data.
 */
async function parseFollowUpBody(c: {
  req: {
    header: (name: string) => string | undefined
    json: () => Promise<unknown>
    raw: Request
  }
}): Promise<
  | {
    ok: true
    prompt: string
    model?: string
    permissionMode?: string
    busyAction?: string
    displayPrompt?: string
    sender?: { kind: 'agent', projectId: string, issueId: string }
    files: SavedFile[]
  } |
  { ok: false, status: 400 | 413 | 500, error: string }
> {
  const contentType = c.req.header('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    let upload: Awaited<ReturnType<typeof receiveAttachments>>
    try {
      upload = await receiveAttachments(c.req.raw)
    } catch (error) {
      if (error instanceof UploadError) return { ok: false, status: error.status, error: error.message }
      throw error
    }
    const keys = ['prompt', 'model', 'permissionMode', 'busyAction', 'displayPrompt']
    const raw: Record<string, string> = {}
    for (const [key, value] of upload.fields) {
      if (keys.includes(key) && !(key in raw)) raw[key] = value
    }
    const { files } = upload
    // Attachment-only messages may have an empty prompt; all limits still apply.
    const schema = files.length > 0 ? AttachmentFollowUpSchema : FollowUpSchema
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      await discardFiles(files)
      return { ok: false, status: 400, error: parsed.error.issues.map(i => i.message).join(', ') }
    }
    return { ok: true, ...parsed.data, files }
  }

  // JSON path with Zod validation
  const raw = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: 'Invalid JSON' })
  })
  const parsed = FollowUpSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues.map(i => i.message).join(', '),
    }
  }
  return { ok: true, ...parsed.data, files: [] }
}

function savedFileToMeta(f: SavedFile) {
  return { id: f.id, name: f.originalName, mimeType: f.mimeType, size: f.size }
}

async function insertAttachmentRecords(
  issueId: string,
  logId: string,
  savedFiles: SavedFile[],
): Promise<void> {
  if (savedFiles.length === 0) return
  await db.insert(attachments).values(
    savedFiles.map(f => ({
      id: f.id,
      issueId,
      logId,
      originalName: f.originalName,
      storedName: f.storedName,
      mimeType: f.mimeType,
      size: f.size,
      storagePath: f.storagePath,
    })),
  )
}

// ---------- Route ----------

const message = createOpenAPIRouter()

// POST /api/projects/:projectId/issues/:id/follow-up — Follow-up
message.post('/:id/follow-up', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false as const, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  // Checked before reading the body so a missing issue never writes uploads
  if (!await getProjectOwnedIssue(project.id, issueId)) {
    return c.json({ success: false as const, error: 'Issue not found' }, 404)
  }

  const parsed = await parseFollowUpBody(c)
  if (!parsed.ok) {
    return c.json({ success: false as const, error: parsed.error }, parsed.status)
  }

  const { files: savedFiles } = parsed
  const prompt = normalizePrompt(parsed.prompt)
  if (!prompt && savedFiles.length === 0) {
    return c.json({ success: false as const, error: 'Prompt is required' }, 400)
  }

  // Re-read: the issue may have changed or been deleted while the body was uploading
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    await discardFiles(savedFiles)
    return c.json({ success: false as const, error: 'Issue not found' }, 404)
  }

  // The sending agent's issue must exist
  const { sender } = parsed
  if (sender) {
    const senderProject = await findProject(sender.projectId)
    const senderIssue = senderProject && await getProjectOwnedIssue(senderProject.id, sender.issueId)
    if (!senderIssue) {
      await discardFiles(savedFiles)
      return c.json({ success: false as const, error: 'Invalid sender issue' }, 400)
    }
  }

  // Reject model changes while the session is actively running
  const isActive = issue.sessionStatus === 'running' || issue.sessionStatus === 'pending'
  if (isActive && parsed.model && parsed.model !== (issue.model ?? '')) {
    await discardFiles(savedFiles)
    return c.json(
      { success: false as const, error: 'Cannot change model while session is running. Wait for completion or cancel first.' },
      409,
    )
  }

  const attachmentsMeta =
    savedFiles.length > 0 ? { attachments: savedFiles.map(savedFileToMeta) } : {}

  const outcome = await dispatchFollowUp(issue, {
    prompt,
    // Build file context for AI engine only
    enginePrompt: prompt + buildFileContext(savedFiles),
    model: parsed.model,
    permissionMode: parsed.permissionMode as 'auto' | 'supervised' | 'plan' | undefined,
    busyAction: parsed.busyAction as 'queue' | 'cancel' | undefined,
    displayPrompt: parsed.displayPrompt ?? (savedFiles.length > 0 ? prompt || undefined : undefined),
    // Always store original prompt for engine use; displayPrompt goes in metadata for UI display
    pendingMeta: {
      ...attachmentsMeta,
      ...(parsed.displayPrompt ? { displayPrompt: parsed.displayPrompt } : {}),
    },
    followUpMeta: attachmentsMeta,
    // Link attachments to the server-assigned message log
    onMessage: messageId => insertAttachmentRecords(issueId, messageId, savedFiles),
    sender,
  })

  if (!outcome.ok) {
    return c.json({ success: false as const, error: outcome.error }, 400)
  }
  if (outcome.queued) {
    return c.json(
      { success: true as const, data: { issueId, messageId: outcome.messageId, queued: true } },
      200,
    )
  }
  return c.json({
    success: true as const,
    data: { executionId: outcome.executionId, issueId, messageId: outcome.messageId },
  }, 200)
})

// GET /api/projects/:projectId/issues/:id/pending — List pending messages
message.openapi(createRoute({
  method: 'get',
  path: '/{id}/pending',
  tags: ['Issues'],
  operationId: 'getIssuesMessagePending',
  request: { params: z.object({ projectId: z.string().min(1), id: z.string().min(1) }) },
  responses: {
    200: successResponse(PendingMessagesSchema, 'Success'),
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

  const { getPendingMessages } = await import('@/db/pending-messages')
  const rows = await getPendingMessages(issueId)

  const entries = rows.map(row => ({
    messageId: row.id,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.createdAt,
  }))

  return c.json({ success: true as const, data: entries }, 200)
})

// DELETE /api/projects/:projectId/issues/:id/pending?messageId=... — Recall pending message
message.openapi(createRoute({
  method: 'delete',
  path: '/{id}/pending',
  tags: ['Issues'],
  operationId: 'deleteIssuesMessagePending',
  request: { params: z.object({ projectId: z.string().min(1), id: z.string().min(1) }), query: z.object({ messageId: z.string().trim().regex(/^[0-9A-Z]{26}$/) }) },
  responses: {
    200: successResponse(RecalledMessageSchema, 'Success'),
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

  const messageId = c.req.query('messageId')?.trim()
  if (!messageId || messageId.length > 26 || !/^[0-9A-Z]{26}$/.test(messageId)) {
    return c.json({ success: false as const, error: 'messageId must be a valid ULID' }, 400)
  }

  const { deletePendingMessage } = await import('@/db/pending-messages')
  const result = await deletePendingMessage(issueId, messageId)
  if (!result) {
    return c.json({ success: false as const, error: 'No pending message found' }, 404)
  }

  // Notify frontend to remove the pending message from display
  emitIssueLogRemoved(issueId, [result.id])

  return c.json({
    success: true as const,
    data: {
      id: result.id,
      content: result.content,
      metadata: result.metadata,
      attachments: result.attachments,
    },
  }, 200)
})

export default message
