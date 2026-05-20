import { autoMoveToReview, updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitDiagnosticLog } from '@/engines/issue/diagnostic'
import { emitIssueSettled } from '@/engines/issue/events'
import { flushTimelineConverter } from '@/engines/issue/pipeline/timeline-emit'
import { cleanupDomainData } from '@/engines/issue/process/state'
import { logger } from '@/logger'
import { resumeDependentForks } from '@/services/fork-dependent'

/**
 * Common settle flow: persist status, auto-move, clean domain data, emit event.
 *
 * NOTE: Worktree cleanup is NOT done here. Worktrees are preserved across
 * completed/failed settlements so follow-ups can reuse them. Cleanup is
 * handled by the periodic cron job in cron/tasks/worktree-cleanup.ts.
 *
 * IMPORTANT: emitIssueSettled() MUST always fire — the SSE route filters
 * terminal states from the 'state' subscriber and only sends them via the
 * 'done' subscriber. If emitIssueSettled is skipped, the frontend never
 * receives a terminal event and stays stuck in "thinking" state forever.
 */
export async function settleIssue(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  status: string,
): Promise<void> {
  try {
    await updateIssueSession(issueId, { sessionStatus: status })
    await autoMoveToReview(issueId)
  } catch (err) {
    logger.error({ issueId, executionId, status, err }, 'settle_issue_partial_failure')
  } finally {
    cleanupDomainData(ctx, executionId)
    emitDiagnosticLog(issueId, executionId, `[BKD] Issue settled (status=${status})`, {
      event: 'issue_settled',
      status,
    })
    // Flush any in-flight thinking/assistant streaming buffers as final
    // 'timeline-entry' events BEFORE 'done' so clients don't drop the tail
    // of the response (the frontend's done-guard previously masked this).
    flushTimelineConverter(issueId)
    emitIssueSettled(issueId, executionId, status)
    // Start any dependent forked issues waiting on this one (PLAN-021).
    void resumeDependentForks(issueId, status).catch(err =>
      logger.error({ issueId, err }, 'resume_dependent_forks_failed'),
    )
  }
}
