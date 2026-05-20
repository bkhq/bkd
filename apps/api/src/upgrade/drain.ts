import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'

// ---------- Graceful upgrade drain ----------
//
// When an upgrade restart is triggered, we want in-flight engine turns to
// finish naturally instead of being killed mid-turn. During the drain window
// new executions are rejected, and the shutdown waits for active processes to
// settle before releasing the port and re-spawning. Any turn that does not
// settle within DRAIN_TIMEOUT_MS falls through to the normal cancelAll path
// (the reconciler then marks it failed on the next startup).

/** Max time to wait for in-flight turns to settle before forcing shutdown. */
export const DRAIN_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const DRAIN_POLL_MS = 1000

let draining = false

/** Whether an upgrade drain is currently in progress (new runs are rejected). */
export function isDraining(): boolean {
  return draining
}

/** Manually toggle the draining flag (used by the shutdown hook). */
export function setDraining(value: boolean): void {
  draining = value
}

/**
 * Block until every active engine process has settled, or until timeoutMs
 * elapses. Sets the draining flag so route handlers reject new executions
 * while we wait. Returns whether the drain completed cleanly.
 */
export async function drainRunningIssues(
  timeoutMs: number = DRAIN_TIMEOUT_MS,
): Promise<{ drained: boolean, remaining: string[] }> {
  setDraining(true)

  const deadline = Date.now() + timeoutMs
  let lastLoggedCount = -1

  while (Date.now() < deadline) {
    const active = issueEngine.getActiveProcesses()
    if (active.length === 0) {
      logger.info('upgrade_drain_complete')
      return { drained: true, remaining: [] }
    }
    if (active.length !== lastLoggedCount) {
      lastLoggedCount = active.length
      logger.info(
        { activeCount: active.length, issues: [...new Set(active.map(p => p.issueId))] },
        'upgrade_drain_waiting',
      )
    }
    await new Promise(r => setTimeout(r, DRAIN_POLL_MS))
  }

  const remaining = [...new Set(issueEngine.getActiveProcesses().map(p => p.issueId))]
  logger.warn({ remaining }, 'upgrade_drain_timeout')
  return { drained: false, remaining }
}
