import { and, desc, eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { logger } from '@/logger'
import { getActionHandler } from './actions'

const MAX_CONSECUTIVE_FAILURES = 3

export interface TaskConfig {
  action: string
  [key: string]: unknown
}

export async function executeTask(
  jobId: string,
  jobName: string,
  taskConfig: TaskConfig,
): Promise<string> {
  const logId = ulid()
  const startedAt = new Date()

  // Insert running log entry
  db.insert(cronJobLogs).values({
    id: logId,
    jobId,
    startedAt,
    status: 'running',
  }).run()

  try {
    const handler = getActionHandler(taskConfig.action)
    if (!handler) {
      throw new Error(`Unknown action: ${taskConfig.action}`)
    }

    const result = await handler(taskConfig)

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    db.update(cronJobLogs)
      .set({ status: 'success', result, finishedAt, durationMs })
      .where(eq(cronJobLogs.id, logId))
      .run()

    logger.debug({ jobName, durationMs, result }, 'cron_job_success')
    return logId
  } catch (err) {
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const error = err instanceof Error ? err.message : String(err)

    db.update(cronJobLogs)
      .set({ status: 'failed', error, finishedAt, durationMs })
      .where(eq(cronJobLogs.id, logId))
      .run()

    logger.error({ jobName, durationMs, err }, 'cron_job_failed')

    // Auto-pause after MAX_CONSECUTIVE_FAILURES consecutive failures
    try {
      const recentLogs = db
        .select({ status: cronJobLogs.status })
        .from(cronJobLogs)
        .where(and(eq(cronJobLogs.jobId, jobId), eq(cronJobLogs.status, 'failed')))
        .orderBy(desc(cronJobLogs.startedAt))
        .limit(MAX_CONSECUTIVE_FAILURES)
        .all()

      // Check the last N logs are all failures (including this one)
      if (recentLogs.length >= MAX_CONSECUTIVE_FAILURES) {
        // Verify no success in between by checking last N logs regardless of status
        const lastN = db
          .select({ status: cronJobLogs.status })
          .from(cronJobLogs)
          .where(eq(cronJobLogs.jobId, jobId))
          .orderBy(desc(cronJobLogs.startedAt))
          .limit(MAX_CONSECUTIVE_FAILURES)
          .all()

        const allFailed = lastN.length >= MAX_CONSECUTIVE_FAILURES
          && lastN.every(l => l.status === 'failed')

        if (allFailed) {
          db.update(cronJobs)
            .set({ enabled: false })
            .where(eq(cronJobs.id, jobId))
            .run()

          // Remove from Baker scheduler
          try {
            const { getBaker } = await import('./index')
            getBaker().pause(jobName)
          } catch { /* Baker may not be initialized */ }

          logger.warn(
            { jobName, consecutiveFailures: MAX_CONSECUTIVE_FAILURES },
            'cron_job_auto_paused',
          )
        }
      }
    } catch (pauseErr) {
      logger.error({ jobName, err: pauseErr }, 'cron_auto_pause_check_failed')
    }

    return logId
  }
}
