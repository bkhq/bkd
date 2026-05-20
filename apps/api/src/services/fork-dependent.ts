/**
 * Resume dependent forked issues when their parent issue settles.
 * See PLAN-021 fork mode 'dependent'.
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { getProjectExecContext, resolveWorkingDir } from '@/engines/issue/utils/helpers'
import { createWorktree } from '@/engines/issue/utils/worktree'
import type { EngineType } from '@/engines/types'
import { emitIssueUpdated } from '@/events/issue-events'
import { logger } from '@/logger'

/**
 * Find issues forked off `parentIssueId` with mode 'dependent' (still
 * awaiting the parent) and start their execution. Fire-and-forget; called
 * from the settle flow. Skipped when the parent was cancelled.
 */
export async function resumeDependentForks(
  parentIssueId: string,
  parentStatus: string,
): Promise<void> {
  if (parentStatus === 'cancelled') return

  let children: Array<typeof issuesTable.$inferSelect>
  try {
    children = await db
      .select()
      .from(issuesTable)
      .where(and(
        eq(issuesTable.parentIssueId, parentIssueId),
        eq(issuesTable.forkAwaitingParent, true),
        eq(issuesTable.isDeleted, 0),
      ))
  } catch (err) {
    logger.error({ parentIssueId, err }, 'resume_dependent_forks_query_failed')
    return
  }

  for (const child of children) {
    try {
      await db
        .update(issuesTable)
        .set({ forkAwaitingParent: false, statusId: 'working', statusUpdatedAt: new Date() })
        .where(eq(issuesTable.id, child.id))
      emitIssueUpdated(child.id, { statusId: 'working' }, undefined, undefined, 'engine')

      const baseDir = await resolveWorkingDir(child.projectId)

      // Start the child worktree off the parent's branch so committed parent
      // work is carried; falls back to main if that branch does not exist.
      if (child.useWorktree) {
        try {
          await createWorktree(baseDir, child.projectId, child.id, `bkd/${parentIssueId}`)
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
