import { updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { cancel } from '@/engines/issue/process/cancel'
import { withIssueLock } from '@/engines/issue/process/lock'
import { getActiveProcesses } from '@/engines/issue/process/state'
import { dispatch } from '@/engines/issue/state'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { logger } from '@/logger'

export async function cancelIssue(
  ctx: EngineContext,
  issueId: string,
): Promise<'interrupted' | 'cancelled'> {
  return withIssueLock(ctx, issueId, async () => {
    logger.info({ issueId }, 'issue_cancel_requested')
    const active = getActiveProcesses(ctx).filter((p) => p.issueId === issueId)
    for (const p of active) {
      logger.debug(
        { issueId, executionId: p.executionId, pid: getPidFromManaged(p) },
        'issue_cancel_active_process',
      )
      dispatch(p, { type: 'CLEAR_PENDING_INPUTS' })
      p.queueCancelRequested = false
      await cancel(ctx, p.executionId, {
        emitCancelledState: false,
        hard: false,
      })
    }
    if (active.length > 0) {
      // Soft cancel: interrupt sent, process stays alive.
      // Do NOT set sessionStatus to 'cancelled' here — the turn-completion
      // flow (handleTurnCompleted) will settle the issue to 'completed' after
      // the engine responds to the interrupt. Writing 'cancelled' here races
      // with the turn-completion DB write and can cause the settlement guard
      // to skip emitIssueSettled, permanently sticking the frontend.
      // The process remains alive and can accept follow-up messages.
      logger.info(
        { issueId, interruptedCount: active.length },
        'issue_cancel_soft_interrupted',
      )
      return 'interrupted'
    }
    // No active processes — mark as cancelled in DB
    await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
    logger.info({ issueId, cancelledCount: 0 }, 'issue_cancel_completed')
    return 'cancelled'
  })
}
