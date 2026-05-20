import { and, desc, eq, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { ulid } from 'ulid'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { indexLog } from '@/db/fts'
import { findProject, getDefaultEngine, getEngineDefaultModel } from '@/db/helpers'
import { issues as issuesTable, issueLogs as logsTable } from '@/db/schema'
import { resolveWorkingDir } from '@/engines/issue/utils/helpers'
import { createWorktree, resolveWorktreePath } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { buildForkContext } from '@/services/fork-context'
import { carryUncommitted } from '@/services/worktree-carry'
import { getProjectOwnedIssue, parseProjectEnvVars, serializeIssue, triggerIssueExecution } from './_shared'

const fork = createOpenAPIRouter()

/** Append an informational system-message log entry to an issue's timeline. */
async function appendSystemMessage(
  issueId: string,
  content: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const [maxRow] = await db
    .select({ maxTurn: max(logsTable.turnIndex) })
    .from(logsTable)
    .where(eq(logsTable.issueId, issueId))
  const turnIndex = (maxRow?.maxTurn ?? 0) + 1
  const logId = ulid()
  db.insert(logsTable)
    .values({
      id: logId,
      issueId,
      turnIndex,
      entryIndex: 0,
      entryType: 'system-message',
      content,
      metadata: JSON.stringify(metadata),
      visible: 1,
    })
    .run()
  indexLog(logId, content)
}

// POST /api/projects/:projectId/issues/:issueId/fork — Fork an issue
fork.openapi(R.forkIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const parent = await getProjectOwnedIssue(project.id, issueId)
  if (!parent) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  const body = c.req.valid('json')
  const { mode } = body
  const includeHistory = body.includeHistory ?? false
  const inheritEngine = body.inheritEngine ?? true
  const autoExecute = body.autoExecute ?? true

  const ctx = await buildForkContext({
    parentIssueId: parent.id,
    instruction: body.instruction,
    includeHistory,
  })
  if (!ctx) {
    return c.json({ success: false, error: 'Failed to build fork context' }, 400 as const)
  }

  // Resolve engine/model
  let engineType: string | null = inheritEngine ? parent.engineType : null
  let model: string | null = inheritEngine ? parent.model : null
  if (!engineType) {
    const def = (await getDefaultEngine()) || 'claude-code'
    engineType = def === 'acp' ? 'acp:gemini' : def
  }
  if (!model) {
    const saved = await getEngineDefaultModel(engineType)
    if (saved && saved !== 'auto') model = saved
  }

  const isDependent = mode === 'dependent'
  const statusId = isDependent ? 'todo' : 'working'

  try {
    const [child] = await db.transaction(async (tx) => {
      const [maxNumRow] = await tx
        .select({ maxNum: max(issuesTable.issueNumber) })
        .from(issuesTable)
        .where(eq(issuesTable.projectId, project.id))
      const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

      const [lastItem] = await tx
        .select({ sortOrder: issuesTable.sortOrder })
        .from(issuesTable)
        .where(and(
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.statusId, statusId),
          eq(issuesTable.isDeleted, 0),
        ))
        .orderBy(desc(issuesTable.sortOrder))
        .limit(1)
      const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

      return tx
        .insert(issuesTable)
        .values({
          projectId: project.id,
          statusId,
          issueNumber,
          title: ctx.title,
          sortOrder,
          parentIssueId: parent.id,
          forkAwaitingParent: isDependent,
          useWorktree: true,
          engineType,
          model,
          sessionStatus: isDependent ? null : 'pending',
          prompt: ctx.prompt,
        })
        .returning()
    })

    if (!child) {
      return c.json({ success: false, error: 'Failed to create forked issue' }, 400 as const)
    }

    await cacheDel(`projectIssueIds:${project.id}`)

    // Bidirectional lineage markers in both timelines.
    await appendSystemMessage(
      parent.id,
      `Forked to issue #${child.issueNumber}: ${child.title}`,
      { kind: 'fork-out', childIssueId: child.id, mode },
    ).catch(err => logger.warn({ issueId: parent.id, err }, 'fork_parent_marker_failed'))

    let carryWarning: string | undefined

    // snapshot mode: pre-create the child worktree and import the parent's
    // uncommitted work before execution kicks off.
    if (mode === 'snapshot') {
      try {
        const baseDir = await resolveWorkingDir(project.id)
        const parentWorkingDir = parent.useWorktree
          ? resolveWorktreePath(project.id, parent.id)
          : baseDir
        const childWorktree = await createWorktree(baseDir, project.id, child.id)
        carryWarning = (await carryUncommitted(parentWorkingDir, childWorktree)) ?? undefined
      } catch (err) {
        logger.warn({ childId: child.id, err }, 'fork_snapshot_failed')
        carryWarning = 'Could not carry uncommitted changes into the new worktree.'
      }
    }

    // Kick off execution for immediate modes.
    if (!isDependent && autoExecute) {
      triggerIssueExecution(
        child.id,
        { engineType, prompt: ctx.prompt, model },
        project.directory || undefined,
        project.systemPrompt,
        parseProjectEnvVars(project.envVars),
      )
    }

    return c.json({
      success: true,
      data: {
        issue: serializeIssue(child),
        parentIssueId: parent.id,
        mode,
        ...(carryWarning ? { carryWarning } : {}),
      },
    }, 201 as const)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        parentIssueId: parent.id,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_fork_failed',
    )
    return c.json({ success: false, error: 'Failed to fork issue' }, 400 as const)
  }
})

export default fork
