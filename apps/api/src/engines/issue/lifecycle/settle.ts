import { autoMoveToReview, updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitIssueSettled } from '@/engines/issue/events'
import { cleanupDomainData } from '@/engines/issue/process/state'
import { cleanupWorktree } from '@/engines/issue/utils/worktree'

/** Common settle flow: persist status, auto-move, clean domain data, emit event. */
export async function settleIssue(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  status: string,
): Promise<void> {
  // Grab worktree info before domain data cleanup removes the entry,
  // then clear it to prevent double-cleanup from other exit paths.
  const managed = ctx.pm.get(executionId)?.meta
  const worktreeBaseDir = managed?.worktreeBaseDir
  const worktreePath = managed?.worktreePath
  if (managed) {
    managed.worktreeBaseDir = undefined
    managed.worktreePath = undefined
  }
  await updateIssueSession(issueId, { sessionStatus: status })
  await autoMoveToReview(issueId)
  cleanupDomainData(ctx, executionId)
  emitIssueSettled(ctx, issueId, executionId, status)
  if (worktreeBaseDir && worktreePath) {
    cleanupWorktree(worktreeBaseDir, issueId, worktreePath)
  }
}
