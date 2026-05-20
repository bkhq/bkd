import { resolve } from 'node:path'
import { and, desc, eq, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { ulid } from 'ulid'
import { cacheDel } from '@/cache'
import { db } from '@/db'
import { indexLog } from '@/db/fts'
import { findProject, getDefaultEngine, getEngineDefaultModel } from '@/db/helpers'
import { issues as issuesTable, issueLogs as logsTable } from '@/db/schema'
import { resolveWorkingDir } from '@/engines/issue/utils/helpers'
import {
  createWorktree,
  isWorktreeRegistered,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import { runCommand } from '@/engines/spawn'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { ROOT_DIR } from '@/root'
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

/**
 * Resolve the parent issue's actual working directory and current HEAD.
 * The child worktree is branched from this HEAD so the parent's committed
 * work is carried — regardless of which branch the parent's agent ended up
 * on (it may have switched to a `feature/*` branch per repo conventions).
 */
async function resolveParentSource(
  projectId: string,
  projectDir: string | null,
  parent: { id: string, useWorktree: boolean },
): Promise<{ workingDir: string, headRef: string | undefined }> {
  const baseDir = projectDir ? resolve(projectDir) : ROOT_DIR
  let workingDir = baseDir
  if (parent.useWorktree) {
    const wt = resolveWorktreePath(projectId, parent.id)
    try {
      if (await isWorktreeRegistered(baseDir, wt)) workingDir = wt
    } catch {
      /* fall back to baseDir */
    }
  }
  const { code, stdout } = await runCommand(
    ['git', 'rev-parse', 'HEAD'],
    { cwd: workingDir, stderr: 'pipe' },
  )
  return { workingDir, headRef: code === 0 ? stdout.trim() : undefined }
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
  const { runWhen } = body
  const inheritEngine = body.inheritEngine ?? true

  const ctx = await buildForkContext({
    parentIssueId: parent.id,
    instruction: body.instruction,
    fromLogId: body.fromLogId,
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

  const isDependent = runWhen === 'after-parent'
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

    await appendSystemMessage(
      parent.id,
      `Forked to issue #${child.issueNumber}: ${child.title}`,
      { kind: 'fork-out', childIssueId: child.id, runWhen },
    ).catch(err => logger.warn({ issueId: parent.id, err }, 'fork_parent_marker_failed'))

    let carryWarning: string | undefined

    // Run-now: branch the child worktree off the parent's current HEAD and
    // carry the parent's uncommitted work before execution kicks off.
    if (!isDependent) {
      try {
        const baseDir = await resolveWorkingDir(project.id)
        const { workingDir: parentDir, headRef } = await resolveParentSource(
          project.id,
          project.directory,
          parent,
        )
        const childWorktree = await createWorktree(baseDir, project.id, child.id, headRef)
        carryWarning = (await carryUncommitted(parentDir, childWorktree)) ?? undefined
      } catch (err) {
        logger.warn({ childId: child.id, err }, 'fork_worktree_seed_failed')
        carryWarning = 'Could not seed the new worktree from the parent; it may start from a clean base.'
      }

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
        runWhen,
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
