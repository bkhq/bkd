import { autoMoveToReview, updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitIssueSettled, emitStateChange } from '@/engines/issue/events'
import { withIssueLock } from '@/engines/issue/process/lock'
import { cleanupDomainData } from '@/engines/issue/process/state'
import { dispatch } from '@/engines/issue/state'
import { getPidFromManaged } from '@/engines/issue/utils/pid'
import { cleanupWorktree } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'

// ---------- Cancel ----------

export async function cancel(
  ctx: EngineContext,
  executionId: string,
  opts: { emitCancelledState?: boolean; hard?: boolean } = {},
): Promise<void> {
  const entry = ctx.pm.get(executionId)
  if (!entry) return
  const managed = entry.meta
  if (entry.state !== 'running') return

  logger.debug(
    {
      issueId: managed.issueId,
      executionId,
      pid: getPidFromManaged(managed),
      emitCancelledState: opts.emitCancelledState !== false,
      hard: opts.hard === true,
    },
    'issue_process_cancel_start',
  )

  managed.process.cancel()

  // Soft cancel: interrupt current turn only and keep process alive.
  if (!opts.hard) {
    managed.cancelledByUser = true
    logger.debug(
      {
        issueId: managed.issueId,
        executionId,
        pid: getPidFromManaged(managed),
      },
      'issue_process_interrupt_sent',
    )
    return
  }

  // Hard cancel: delegate kill timeout to PM
  managed.state = 'cancelled'
  if (opts.emitCancelledState !== false) {
    emitStateChange(ctx, managed.issueId, executionId, 'cancelled')
  }

  await ctx.pm.terminate(executionId, () => managed.process.cancel())
  managed.finishedAt = entry.finishedAt ?? new Date()
  logger.debug(
    { issueId: managed.issueId, executionId, pid: getPidFromManaged(managed) },
    'issue_process_cancel_finished',
  )
}

// ---------- Force terminate ----------

/**
 * Force-terminate a process regardless of its current state.
 * Works on running, spawning, completed, failed, or cancelled processes.
 * Updates DB session status and moves the issue to review.
 */
export async function terminateProcess(
  ctx: EngineContext,
  issueId: string,
): Promise<void> {
  return withIssueLock(ctx, issueId, async () => {
    // Kill active processes (spawning or running)
    const active = ctx.pm.getActiveInGroup(issueId)
    let lastExecutionId = ''
    const worktreeEntries: Array<{ baseDir: string; path: string }> = []
    for (const entry of active) {
      const managed = entry.meta
      logger.info(
        {
          issueId,
          executionId: entry.id,
          pid: getPidFromManaged(managed),
          state: entry.state,
        },
        'force_terminate_active_process',
      )
      if (managed.worktreeBaseDir && managed.worktreePath) {
        worktreeEntries.push({
          baseDir: managed.worktreeBaseDir,
          path: managed.worktreePath,
        })
        managed.worktreeBaseDir = undefined
        managed.worktreePath = undefined // prevent double-cleanup
      }
      dispatch(managed, { type: 'CLEAR_PENDING_INPUTS' })
      managed.state = 'cancelled'
      emitStateChange(ctx, issueId, entry.id, 'cancelled')
      ctx.pm.forceKill(entry.id)
      cleanupDomainData(ctx, entry.id)
      lastExecutionId = entry.id
    }

    await updateIssueSession(issueId, { sessionStatus: 'cancelled' })
    await autoMoveToReview(issueId)
    emitIssueSettled(ctx, issueId, lastExecutionId, 'cancelled')
    for (const wt of worktreeEntries) {
      cleanupWorktree(wt.baseDir, issueId, wt.path)
    }
    logger.info({ issueId }, 'force_terminate_completed')
  })
}
