import { and, desc, eq, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { findProject, getDefaultEngine, getEngineDefaultModel, getServerUrl } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { engineRegistry } from '@/engines/executors'
import type { EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { buildIssueUrl, dispatch as webhookDispatch } from '@/webhooks/dispatcher'
import {
  parseProjectEnvVars,
  serializeIssue,
  serializeTags,
  triggerIssueExecution,
} from './_shared'

const create = createOpenAPIRouter()

// POST /api/projects/:projectId/issues — Create issue
create.openapi(R.createIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const body = c.req.valid('json')

  // Resolve engine/model defaults when not explicitly provided
  let resolvedEngine = body.engineType ?? null
  let resolvedModel = body.model ?? null

  if (!resolvedEngine) {
    // Precedence: explicit body > project default > global default > fallback.
    const defaultEng = project.defaultEngine
      || (await getDefaultEngine())
      || 'claude-code'
    resolvedEngine = defaultEng as EngineType
  }
  // Coerce a stale/unsupported persisted engine (e.g. a removed engine type
  // still saved as a project/global default) to a supported one. The registry
  // is the source of truth for which engines are actually installed.
  if (!engineRegistry.get(resolvedEngine)) {
    resolvedEngine = 'claude-code'
  }
  if (!resolvedModel) {
    // Precedence: explicit body > project default > global engine default.
    // The project default model only applies when the resolved engine is the
    // project's default engine — otherwise an explicit engine override would
    // be paired with a model meant for a different engine.
    if (
      project.defaultModel
      && project.defaultModel !== 'auto'
      && project.defaultEngine
      && resolvedEngine === project.defaultEngine
    ) {
      resolvedModel = project.defaultModel
    } else {
      const savedModel = await getEngineDefaultModel(resolvedEngine!)
      if (savedModel && savedModel !== 'auto') {
        resolvedModel = savedModel
      }
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

      return tx
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
          model: resolvedModel,
          sessionStatus: shouldExecute ? 'pending' : null,
          prompt: issuePrompt,
        })
        .returning()
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

    return c.json({ success: true, data: serializeIssue(newIssue!) }, (shouldExecute ? 202 : 201) as 201 | 202)
  } catch (error) {
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
