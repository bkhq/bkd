/**
 * Resume dependent forked issues when their parent issue settles.
 * See PLAN-021 / FORK-002.
 */
import { resolve } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { getProjectExecContext, resolveWorkingDir } from '@/engines/issue/utils/helpers'
import {
  createWorktree,
  isWorktreeRegistered,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import { runCommand } from '@/engines/spawn'
import type { EngineType } from '@/engines/types'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'
import { carryUncommitted } from '@/services/worktree-carry'

/** Resolve the parent issue's working directory and current HEAD commit. */
async function resolveParentSource(
  parent: typeof issuesTable.$inferSelect,
  baseDir: string,
): Promise<{ workingDir: string, headRef: string | undefined }> {
  let workingDir = baseDir
  if (parent.useWorktree) {
    const wt = resolveWorktreePath(parent.projectId, parent.id)
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

/**
 * Find issues forked off `parentIssueId` with runWhen 'after-parent' (still
 * awaiting the parent) and start their execution. Fire-and-forget; called
 * from the settle flow. Skipped when the parent was cancelled.
 *
 * Each child worktree is branched from the parent's current HEAD (so the
 * parent's committed work carries) and seeded with its uncommitted changes.
 */
export async function resumeDependentForks(
  parentIssueId: string,
  parentStatus: string,
): Promise<void> {
  if (parentStatus === 'cancelled') return

  let children: Array<typeof issuesTable.$inferSelect>
  let parent: typeof issuesTable.$inferSelect | undefined
  try {
    children = await db
      .select()
      .from(issuesTable)
      .where(and(
        eq(issuesTable.parentIssueId, parentIssueId),
        eq(issuesTable.forkAwaitingParent, true),
        eq(issuesTable.isDeleted, 0),
      ))
    if (children.length === 0) {
      return
    }
    const parentRows = await db
      .select()
      .from(issuesTable)
      .where(eq(issuesTable.id, parentIssueId))
    parent = parentRows[0]
  } catch (err) {
    logger.error({ parentIssueId, err }, 'resume_dependent_forks_query_failed')
    return
  }
  if (!parent) return

  for (const child of children) {
    try {
      await db
        .update(issuesTable)
        .set({ forkAwaitingParent: false, statusId: 'working', statusUpdatedAt: new Date() })
        .where(eq(issuesTable.id, child.id))
      emitIssueUpdated(child.id, { statusId: 'working' }, undefined, undefined, 'engine')

      const baseDir = await resolveWorkingDir(child.projectId)

      // Branch the child worktree off the parent's HEAD and seed uncommitted
      // work — same as a run-now fork, just deferred to parent settlement.
      if (child.useWorktree) {
        try {
          const { workingDir: parentDir, headRef } = await resolveParentSource(parent, resolve(baseDir))
          const childWorktree = await createWorktree(baseDir, child.projectId, child.id, headRef)
          await carryUncommitted(parentDir, childWorktree)
        } catch (wtErr) {
          logger.warn({ childId: child.id, err: wtErr }, 'dependent_fork_worktree_failed')
        }
      }

      const projCtx = await getProjectExecContext(child.projectId)
      const basePrompt = projCtx.systemPrompt
        ? `${projCtx.systemPrompt}\n\n${child.prompt ?? ''}`
        : (child.prompt ?? '')

      await issueEngine.executeIssue(child.id, {
        engineType: (child.engineType ?? 'claude-code') as EngineType,
        prompt: basePrompt,
        workingDir: baseDir,
        model: child.model ?? undefined,
        envVars: projCtx.envVars,
      })
      logger.info({ childId: child.id, parentIssueId }, 'dependent_fork_resumed')
    } catch (err) {
      logger.error({ childId: child.id, parentIssueId, err }, 'dependent_fork_resume_failed')
      await db
        .update(issuesTable)
        .set({ sessionStatus: 'failed' })
        .where(eq(issuesTable.id, child.id))
        .catch(() => {})
      emitIssueUpdated(child.id, { sessionStatus: 'failed' }, undefined, undefined, 'engine')
    }
  }
}
