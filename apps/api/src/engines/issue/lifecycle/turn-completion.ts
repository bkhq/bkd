import { relocatePendingForProcessing, restorePendingVisibility } from '@/db/pending-messages'
import { autoMoveToReview, getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import type { EngineContext } from '@/engines/issue/context'
import { emitIssueSettled, emitStateChange } from '@/engines/issue/events'
import { dispatch } from '@/engines/issue/state'
import type { ManagedProcess } from '@/engines/issue/types'
import { sendInputToRunningProcess } from '@/engines/issue/user-message'
import type { ProcessStatus } from '@/engines/types'
import { emitIssueLogRemoved } from '@/events/issue-events'
import { logger } from '@/logger'

// Settlement after a turn completes is driven by a per-engine grace timer:
//   - ACP engines (opencode, gemini) — 5s grace so trailing thinking/tool
//     output emitted after acp-prompt-result doesn't trigger a premature
//     "review" transition, and the user has a wider window to send a
//     follow-up that cancels settlement.
//   - Non-ACP conversational engines (Claude Code, codex) — 1s grace.
//   - Any engine + process already exited — settle immediately (the
//     conversation cannot continue).
//
// Process exit and idle timeout remain backup paths:
//   - monitorCompletion → flushSettleTimer on subprocess exit.
//   - gcSweep idle timeout terminates and settles long-orphaned processes.
//
// See handleTurnCompleted Phase 2.

// ---------- Turn completion ----------

export function handleTurnCompleted(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
): void {
  const managed = ctx.pm.get(executionId)?.meta
  if (!managed || managed.state !== 'running') return
  // Guard: if turnInFlight is already false, this is a duplicate turn-completion
  // entry from the stream (e.g. Claude emits a result entry followed by a system
  // stop entry, or the stream continues producing result entries after settlement).
  // Without this guard, each entry would trigger a new settlement cycle.
  if (!managed.turnInFlight) return
  dispatch(managed, { type: 'TURN_COMPLETED' })
  logger.debug(
    { issueId, executionId, queued: managed.pendingInputs.length },
    'issue_turn_completed',
  )

  if (managed.pendingInputs.length > 0) {
    void flushQueuedInputs(ctx, issueId, managed)
    return
  }

  // No queued inputs — the AI turn is done and the process is idle.
  // For conversational engines the subprocess stays alive, so monitorCompletion
  // (which awaits subprocess.exited) will not fire yet.
  //
  // IMPORTANT: Do NOT change managed.state here. The subprocess is still alive
  // and can receive follow-up input. Keeping state as 'running' ensures
  // getActiveProcessForIssue() can find it, preventing duplicate process spawns.
  // The turnSettled flag tells monitorCompletion() to just clean up on exit.

  // Track when the process became idle for idle timeout cleanup
  managed.lastIdleAt = new Date()

  const finalStatus = managed.logicalFailure ? 'failed' : 'completed'
  emitStateChange(issueId, executionId, finalStatus as ProcessStatus)

  // Phase 1: Immediately update sessionStatus + handle session errors + pending
  // DB messages. The statusId change (working → review) and the frontend
  // settlement event are deferred to Phase 2 so that follow-ups sent within
  // the grace period keep the issue in 'working'.
  void (async () => {
    try {
      // Detect session ID error: the CLI couldn't find the session
      // (e.g. "No conversation found with session ID: xxx" after project
      // directory change).  Only reset externalSessionId when the error
      // specifically mentions the session, so other failures (API errors,
      // network issues, etc.) don't clear a valid session.
      const hasAssistantOutput = managed.logs
        .toArray()
        .some(l => l.entryType === 'assistant-message')
      const reason = (managed.logicalFailureReason ?? '').toLowerCase()
      const isSessionError =
        finalStatus === 'failed' &&
        !hasAssistantOutput &&
        (reason.includes('no conversation found') || reason.includes('session'))
      if (isSessionError) {
        logger.warn(
          { issueId, executionId, reason: managed.logicalFailureReason },
          'session_id_error_resetting_session',
        )
        await updateIssueSession(issueId, {
          sessionStatus: finalStatus,
          externalSessionId: null,
        })
      } else {
        await updateIssueSession(issueId, { sessionStatus: finalStatus })
      }

      // Check for pending DB messages before moving to review.
      // If the user sent messages while the engine was busy, they were queued
      // as pending in the DB. Relocate: hide old pending row, let follow-up
      // create a new entry at the current position in the conversation.
      const relocated = await relocatePendingForProcessing(issueId)
      if (relocated) {
        logger.info(
          { issueId, executionId, oldPendingIds: relocated.oldIds, mergedCount: relocated.oldIds.length },
          'auto_flush_pending_after_turn',
        )
        try {
          const issue = await getIssueWithSession(issueId)
          await ctx.followUpIssue?.(
            issueId,
            relocated.prompt,
            issue?.model ?? undefined,
            undefined, // permissionMode
            undefined, // busyAction
            relocated.displayPrompt,
            relocated.metadata,
          )
          // Notify frontend to remove the old pending entries
          emitIssueLogRemoved(issueId, relocated.oldIds)
          logger.debug({ issueId, executionId }, 'turn_deferred_to_followup')
          return
        } catch (flushErr) {
          logger.error({ issueId, err: flushErr }, 'auto_flush_pending_failed')
          restorePendingVisibility(relocated.oldIds)
          // Fall through to normal review flow
        }
      }

      // Phase 2: Move to review.
      // All engines get a grace period before auto-settle so follow-ups sent
      // immediately after a turn completes can cancel the settlement and keep
      // the issue in 'working'.
      //   - ACP engines: longer delay (5s) to accommodate adapters that may
      //     have trailing output after acp-prompt-result.
      //   - Non-ACP engines: 1s delay for quick follow-up cancellation.
      //   - Any engine + process exited: immediate settle.
      const isAcpEngine = managed.engineType.startsWith('acp')
      const processAlive = managed.exitCode === undefined
      const delayMs = processAlive ? (isAcpEngine ? 5000 : 1000) : 0

      if (delayMs > 0) {
        managed.settleTimerStatus = finalStatus
        managed.settleTimer = setTimeout(() => {
          managed.settleTimer = undefined
          managed.settleTimerStatus = undefined
          void settleAfterGrace(ctx, issueId, executionId, managed, finalStatus)
        }, delayMs)
      } else {
        await settleAfterGrace(ctx, issueId, executionId, managed, finalStatus)
      }
    } catch (error) {
      // Cancel any pending delayed settle — the fallback below will handle it.
      if (managed.settleTimer) {
        clearTimeout(managed.settleTimer)
        managed.settleTimer = undefined
        managed.settleTimerStatus = undefined
      }
      logger.error({ issueId, executionId, error }, 'issue_turn_settle_failed')
      // Safety net: ensure frontend is always notified even if settlement
      // partially failed. Without this, the frontend never receives the
      // 'done' SSE event and stays stuck in "thinking" state indefinitely
      // (terminal states are filtered from the 'state' subscriber).
      //
      // Guard: skip if a follow-up has reactivated the issue.
      // Check for a DIFFERENT active PM process for this issue (not our own
      // executionId). Also check if DB status already diverged to a terminal
      // state we didn't set.
      try {
        const freshIssue = await getIssueWithSession(issueId)
        const currentStatus = freshIssue?.sessionFields.sessionStatus
        const hasOtherActive = ctx.pm
          .getActive()
          .some(e => e.meta.issueId === issueId && e.id !== executionId)
        if (
          hasOtherActive ||
          (currentStatus !== finalStatus &&
            currentStatus !== 'running' &&
            currentStatus !== 'pending')
        ) {
          logger.debug(
            {
              issueId,
              executionId,
              finalStatus,
              currentStatus,
              hasOtherActive,
            },
            'issue_turn_settle_catch_skipped_reactivated',
          )
          return
        }
        await updateIssueSession(issueId, { sessionStatus: finalStatus })
      } catch (innerErr) {
        logger.error({ issueId, executionId, err: innerErr }, 'issue_turn_settle_catch_db_failed')
      }
      emitIssueSettled(issueId, executionId, finalStatus)
    }
  })()
}

/**
 * Move the issue to 'review' and emit the settled event.
 *
 * Guards:
 *   - If a new turn started (turnSettled === false), skip.
 *   - If sessionStatus diverged from finalStatus, skip (reactivated).
 */
async function settleAfterGrace(
  ctx: EngineContext,
  issueId: string,
  executionId: string,
  managed: ManagedProcess,
  finalStatus: string,
): Promise<void> {
  try {
    // Guard 1: if a new turn started during the grace period, skip
    if (!managed.turnSettled) {
      logger.debug({ issueId, executionId }, 'issue_turn_settle_cancelled_new_turn')
      return
    }

    // Guard 2: if a follow-up reactivated the issue while we waited, the DB
    // sessionStatus will no longer match finalStatus.
    const freshIssue = await getIssueWithSession(issueId)

    // Re-check turnSettled after the async DB round-trip — START_TURN may
    // have fired during the await window (race: timer triggers, user sends
    // follow-up before getIssueWithSession returns).
    if (!managed.turnSettled) {
      logger.debug({ issueId, executionId }, 'issue_turn_settle_cancelled_new_turn_race')
      return
    }

    if (freshIssue && freshIssue.sessionFields.sessionStatus !== finalStatus) {
      logger.debug(
        {
          issueId,
          executionId,
          finalStatus,
          currentStatus: freshIssue.sessionFields.sessionStatus,
        },
        'issue_turn_settle_skipped_reactivated',
      )
      return
    }

    // Guard 3: one last check before the mutating DB call — START_TURN
    // could have fired during the await above.
    if (!managed.turnSettled) {
      logger.debug({ issueId, executionId }, 'issue_turn_settle_cancelled_new_turn_final')
      return
    }

    await autoMoveToReview(issueId)
    emitIssueSettled(issueId, executionId, finalStatus)
    logger.info({ issueId, executionId, finalStatus }, 'issue_turn_settled')
  } catch (err) {
    logger.error({ issueId, executionId, err }, 'issue_turn_delayed_settle_failed')
    // Safety net: always notify frontend even on error
    if (managed.turnSettled) {
      emitIssueSettled(issueId, executionId, finalStatus)
    }
  }
}

/**
 * Settle immediately (called when the process exits).
 *
 * Backup path for all engines: if the subprocess dies before its
 * post-turn grace timer fires (1s non-ACP / 5s ACP), clear the timer
 * and settle now. The conversation cannot continue without the process,
 * so there is no value in waiting out the remaining grace window.
 */
export function flushSettleTimer(
  ctx: EngineContext,
  managed: ManagedProcess,
): void {
  if (managed.settleTimer) {
    clearTimeout(managed.settleTimer)
    managed.settleTimer = undefined
  }
  const finalStatus = managed.settleTimerStatus ?? (managed.logicalFailure ? 'failed' : 'completed')
  managed.settleTimerStatus = undefined
  void settleAfterGrace(ctx, managed.issueId, managed.executionId, managed, finalStatus)
}

export async function flushQueuedInputs(
  ctx: EngineContext,
  issueId: string,
  managed: ManagedProcess,
): Promise<void> {
  if (managed.state !== 'running' || managed.turnInFlight) return
  if (managed.pendingInputs.length === 0) return

  // Merge ALL queued inputs into a single message so the agent receives
  // one combined prompt instead of being sent messages one at a time.
  // Snapshot the array instead of splicing — if sendInputToRunningProcess
  // throws, the messages remain in pendingInputs for the next flush attempt.
  const all = [...managed.pendingInputs]
  const mergedPrompt = all
    .map(i => i.prompt)
    .filter(Boolean)
    .join('\n\n')
  // Use the latest model override (last wins)
  const lastModel = all.reduce<string | undefined>((acc, i) => i.model ?? acc, undefined)
  // Merge display prompts for the UI message bubble
  const mergedDisplay =
    all
      .map(i => i.displayPrompt)
      .filter(Boolean)
      .join('\n\n') || undefined

  logger.debug(
    {
      issueId,
      executionId: managed.executionId,
      mergedCount: all.length,
      promptChars: mergedPrompt.length,
    },
    'issue_queue_flush_merged_inputs',
  )

  if (lastModel) {
    await updateIssueSession(issueId, { model: lastModel })
  }
  try {
    sendInputToRunningProcess(
      ctx,
      issueId,
      managed,
      mergedPrompt,
      mergedDisplay,
      all.at(-1)?.metadata,
    )
    // Remove only the consumed messages — new inputs queued during the
    // await above are preserved for the next flush cycle.
    dispatch(managed, { type: 'SPLICE_PENDING_INPUTS', count: all.length })
  } catch (err) {
    // Messages preserved in managed.pendingInputs for next flush attempt
    logger.error(
      { issueId, executionId: managed.executionId, err },
      'flush_queued_inputs_send_failed',
    )
    throw err
  }
}
