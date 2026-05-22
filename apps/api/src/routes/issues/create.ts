import { unlink } from 'node:fs/promises'
import { and, desc, eq, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import * as z from 'zod'
import { cacheDel } from '@/cache'
import { STATUS_IDS } from '@/config'
import { db } from '@/db'
import { findProject, getDefaultEngine, getEngineDefaultModel, getServerUrl } from '@/db/helpers'
import { attachments as attachmentsTable, issues as issuesTable } from '@/db/schema'
import { engineRegistry } from '@/engines/executors'
import type { EngineType } from '@/engines/types'
import { getVirtualEngine } from '@/engines/virtual-engines'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import type { SavedFile } from '@/uploads'
import { saveUploadedFile, validateFiles } from '@/uploads'
import { buildIssueUrl, dispatch as webhookDispatch } from '@/webhooks/dispatcher'
import {
  parseProjectEnvVars,
  serializeIssue,
  serializeTags,
  triggerIssueExecution,
} from './_shared'

const create = createOpenAPIRouter()

// ── Body parsing ─────────────────────────────────────

const createBodySchema = z.object({
  title: z.string().min(1).max(500),
  tags: z.array(z.string().max(50)).max(10).optional(),
  statusId: z.enum(STATUS_IDS),
  useWorktree: z.boolean().optional(),
  keepAlive: z.boolean().optional(),
  // Accepts a real engine type or a virtual engine id; resolved server-side.
  engineType: z.string().regex(/^[\w.\-:]{1,64}$/).optional(),
  model: z.string().regex(/^[\w./:\-[\]]{1,160}$/).optional(),
  permissionMode: z.enum(['auto', 'supervised', 'plan']).optional(),
})

type CreateBody = z.infer<typeof createBodySchema>

async function parseCreateBody(c: {
  req: {
    header: (name: string) => string | undefined
    json: () => Promise<unknown>
    formData: () => Promise<FormData>
  }
}): Promise<
  | { ok: true, body: CreateBody, files: File[] }
  | { ok: false, error: string }
> {
  const contentType = c.req.header('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const fd = await c.req.formData()
    const raw: Record<string, unknown> = {}
    for (const [key, value] of fd.entries()) {
      // Skip File entries (key === 'files'); only string scalars feed the body
      if (typeof value !== 'string') continue
      if (key === 'tags') {
        try {
          raw.tags = JSON.parse(value)
        } catch {
          raw.tags = value.split(',').map(s => s.trim()).filter(Boolean)
        }
      } else if (key === 'useWorktree' || key === 'keepAlive') {
        // Strict: silently coercing typos like "tru" to false hides client bugs.
        if (value !== 'true' && value !== 'false' && value !== '1' && value !== '0') {
          return { ok: false, error: `${key} must be "true", "false", "1", or "0"` }
        }
        raw[key] = value === 'true' || value === '1'
      } else {
        raw[key] = value
      }
    }
    const parsed = createBodySchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map(i => i.message).join(', ') }
    }
    const files: File[] = []
    for (const entry of fd.getAll('files')) {
      if (entry instanceof File) files.push(entry)
    }
    return { ok: true, body: parsed.data, files }
  }

  // JSON path
  const raw = await c.req.json()
  const parsed = createBodySchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map(i => i.message).join(', ') }
  }
  return { ok: true, body: parsed.data, files: [] }
}

// ── Handler ──────────────────────────────────────────

// POST /api/projects/:projectId/issues — Create issue
// Accepts JSON or multipart/form-data. With multipart, `files` parts are saved
// as attachments and folded into the engine prompt on first execute.
create.post('/', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const parsed = await parseCreateBody(c)
  if (!parsed.ok) {
    return c.json({ success: false, error: parsed.error }, 400 as const)
  }
  const { body, files } = parsed

  if (files.length > 0) {
    const validation = validateFiles(files)
    if (!validation.ok) {
      return c.json({ success: false, error: validation.error }, 400 as const)
    }
  }

  // Resolve engine/model defaults when not explicitly provided
  const explicitEngine = !!body.engineType
  let resolvedEngine = body.engineType ?? null
  let resolvedModel = body.model ?? null
  let engineProfileId: string | null = null

  if (!resolvedEngine) {
    // Precedence: explicit body > project default > global default > fallback.
    resolvedEngine = (project.defaultEngine
      || (await getDefaultEngine())
      || 'claude-code') as EngineType
  }

  // A virtual engine id (from any source: body, project, or global default)
  // resolves to its base engine + preset model; the virtual id is persisted so
  // the spawn paths inject its env vars.
  const virtual = await getVirtualEngine(resolvedEngine)
  if (virtual) {
    engineProfileId = virtual.id
    resolvedEngine = virtual.baseEngine
    if (!resolvedModel && virtual.model) resolvedModel = virtual.model
  }

  // Engine identity for per-engine settings + the project-default comparison:
  // the virtual id when this is a virtual engine, otherwise the real type.
  const engineId = engineProfileId ?? resolvedEngine

  if (!engineRegistry.get(resolvedEngine as EngineType)) {
    if (explicitEngine && !virtual) {
      // An explicit, unrecognized engine id is a client error — do not silently
      // misroute to the fallback engine.
      return c.json({ success: false, error: `Unknown engine type: ${resolvedEngine}` }, 400 as const)
    }
    // A stale/removed project/global default → coerce to a supported engine.
    resolvedEngine = 'claude-code'
  }
  if (!resolvedModel) {
    // Precedence: explicit body > project default > saved engine default.
    // The project default model only applies when the resolved engine matches
    // the project's default engine (compared by engine identity, so a virtual
    // default engine still matches its own saved model).
    if (
      project.defaultModel
      && project.defaultModel !== 'auto'
      && project.defaultEngine
      && engineId === project.defaultEngine
    ) {
      resolvedModel = project.defaultModel
    } else {
      const savedModel = await getEngineDefaultModel(engineId)
      if (savedModel && savedModel !== 'auto') {
        resolvedModel = savedModel
      }
    }
  }

  // Save files to disk BEFORE opening the issue transaction so a disk failure
  // surfaces as a clean 400 with no issue row created. The transaction inserts
  // the issue and its attachment rows together; on rollback we unlink the
  // disk files so the API response and persisted state stay in lockstep
  // (no orphaned issue rows, no orphaned files driving client-side retries).
  let savedFiles: SavedFile[] = []
  if (files.length > 0) {
    try {
      savedFiles = await Promise.all(files.map(saveUploadedFile))
    } catch (saveError) {
      logger.warn(
        { projectId: project.id, error: saveError },
        'issue_create_attachment_save_failed',
      )
      return c.json({ success: false, error: 'Failed to save uploaded files' }, 400 as const)
    }
  }

  try {
    const issuePrompt = body.title
    const shouldExecute = body.statusId === 'working' || body.statusId === 'review'
    // review → working: auto-downgrade so the execution engine picks it up
    const effectiveStatusId = body.statusId === 'review' ? 'working' : body.statusId

    const [newIssue] = await db.transaction(async (tx) => {
      // Compute next issueNumber across ALL issues (including soft-deleted) to avoid reuse
      const [maxNumRow] = await tx
        .select({ maxNum: max(issuesTable.issueNumber) })
        .from(issuesTable)
        .where(eq(issuesTable.projectId, project.id))
      const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

      // Compute sortOrder: place after the last item in the target status column
      const [lastItem] = await tx
        .select({ sortOrder: issuesTable.sortOrder })
        .from(issuesTable)
        .where(
          and(
            eq(issuesTable.projectId, project.id),
            eq(issuesTable.statusId, effectiveStatusId),
            eq(issuesTable.isDeleted, 0),
          ),
        )
        .orderBy(desc(issuesTable.sortOrder))
        .limit(1)
      const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

      const inserted = await tx
        .insert(issuesTable)
        .values({
          projectId: project.id,
          statusId: effectiveStatusId,
          issueNumber,
          title: body.title,
          tag: serializeTags(body.tags),
          sortOrder,
          useWorktree: body.useWorktree ?? false,
          keepAlive: body.keepAlive ?? false,
          engineType: resolvedEngine,
          engineProfileId,
          model: resolvedModel,
          sessionStatus: shouldExecute ? 'pending' : null,
          prompt: issuePrompt,
        })
        .returning()

      // Attachment rows share the transaction with the issue insert so a
      // failure here rolls back the issue too — kept in lockstep with the
      // unlink-on-failure logic in the outer catch.
      if (savedFiles.length > 0) {
        await tx.insert(attachmentsTable).values(
          savedFiles.map(f => ({
            id: f.id,
            issueId: inserted[0]!.id,
            logId: null,
            originalName: f.originalName,
            storedName: f.storedName,
            mimeType: f.mimeType,
            size: f.size,
            storagePath: f.storagePath,
          })),
        )
      }

      return inserted
    })

    // After successful creation, invalidate relevant caches
    await cacheDel(`projectIssueIds:${project.id}`)

    const webhookPayload: Record<string, unknown> = {
      event: 'issue.created',
      issueId: newIssue!.id,
      issueNumber: newIssue!.issueNumber,
      projectId: project.id,
      projectName: project.name,
      title: body.title,
      statusId: effectiveStatusId,
      engineType: resolvedEngine,
      model: resolvedModel,
      timestamp: new Date().toISOString(),
    }
    const serverUrl = await getServerUrl()
    if (serverUrl) {
      webhookPayload.issueUrl = buildIssueUrl(serverUrl, project.id, newIssue!.id)
    }
    void webhookDispatch('issue.created', webhookPayload, `issue.created:${newIssue!.id}`)

    // Only auto-execute when created directly in working
    if (shouldExecute) {
      triggerIssueExecution(
        newIssue!.id,
        {
          engineType: resolvedEngine,
          prompt: issuePrompt,
          model: resolvedModel,
          permissionMode: body.permissionMode,
        },
        project.directory || undefined,
        project.systemPrompt,
        parseProjectEnvVars(project.envVars),
      )
    }

    return c.json(
      { success: true, data: serializeIssue(newIssue!) },
      (shouldExecute ? 202 : 201) as 201 | 202,
    )
  } catch (error) {
    // Transaction rolled back — unlink the disk files we saved up-front so we
    // don't accumulate orphans alongside the rollback.
    if (savedFiles.length > 0) {
      await Promise.all(
        savedFiles.map(f =>
          unlink(f.absolutePath).catch(unlinkError =>
            logger.warn(
              { projectId: project.id, path: f.absolutePath, error: unlinkError },
              'issue_create_attachment_cleanup_failed',
            ),
          ),
        ),
      )
    }
    logger.warn(
      {
        projectId: project.id,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_create_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Failed to create issue',
      },
      400 as const,
    )
  }
})

export default create
