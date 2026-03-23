import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db } from '@/db'
import { cronJobLogs } from '@/db/schema'
import { logger } from '@/logger'
import { getBuiltinHandler } from './registry'

export interface TaskConfig {
  handler?: string // for builtin tasks
  [key: string]: unknown
}

export async function executeTask(
  jobId: string,
  jobName: string,
  taskType: string,
  taskConfig: TaskConfig,
): Promise<void> {
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
    let result: string

    switch (taskType) {
      case 'builtin': {
        const handler = getBuiltinHandler(taskConfig.handler ?? jobName)
        if (!handler) {
          throw new Error(`Unknown builtin handler: ${taskConfig.handler ?? jobName}`)
        }
        result = await handler()
        break
      }
      default:
        throw new Error(`Unknown task type: ${taskType}`)
    }

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    db.update(cronJobLogs)
      .set({ status: 'success', result, finishedAt, durationMs })
      .where(eq(cronJobLogs.id, logId))
      .run()

    logger.debug({ jobName, durationMs, result }, 'cron_job_success')
  } catch (err) {
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const error = err instanceof Error ? err.message : String(err)

    db.update(cronJobLogs)
      .set({ status: 'failed', error, finishedAt, durationMs })
      .where(eq(cronJobLogs.id, logId))
      .run()

    logger.error({ jobName, durationMs, err }, 'cron_job_failed')
  }
}
