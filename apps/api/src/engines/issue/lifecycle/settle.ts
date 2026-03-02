import { autoMoveToReview, updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitIssueSettled } from '@/engines/issue/events'
import { cleanupDomainData } from '@/engines/issue/process/state'

/** Common settle flow: persist status, auto-move, clean domain data, emit event.
 *
 * NOTE: Worktree cleanup is NOT done here. Worktrees are preserved across
 * completed/failed settlements so follow-ups can reuse them. Cleanup only
 * happens on terminal lifecycle transitions (done/cancel) via update.ts
 * and cancel.ts respectively.
 */
export async function settleIssue(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  status: string,
): Promise<void> {
  await updateIssueSession(issueId, { sessionStatus: status })
  await autoMoveToReview(issueId)
  cleanupDomainData(ctx, executionId)
  emitIssueSettled(ctx, issueId, executionId, status)
}
