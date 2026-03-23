import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import type { cronJobs } from '@/db/schema'
import { cronJobLogs } from '@/db/schema'
import { getBaker } from './index'

export interface SerializedCronJob {
  id: string
  name: string
  cron: string
  taskType: string
  taskConfig: Record<string, unknown>
  enabled: boolean
  status: string
  nextExecution: string | null
  lastRun: {
    status: string
    startedAt: Date
    durationMs: number | null
    result: string | null
    error: string | null
  } | null
  createdAt: Date
  updatedAt: Date
}

export function serializeJob(row: typeof cronJobs.$inferSelect): SerializedCronJob {
  let status = 'unknown'
  let nextExecution: string | null = null

  try {
    const baker = getBaker()
    status = baker.getStatus(row.name)
    const next = baker.nextExecution(row.name)
    nextExecution = next ? next.toISOString() : null
  } catch {
    status = row.enabled ? 'not_loaded' : 'disabled'
  }

  let taskConfig: Record<string, unknown> = {}
  try {
    taskConfig = JSON.parse(row.taskConfig)
  } catch {
    taskConfig = { _raw: row.taskConfig }
  }

  // Get latest log for this job
  const [latestLog] = db
    .select()
    .from(cronJobLogs)
    .where(eq(cronJobLogs.jobId, row.id))
    .orderBy(desc(cronJobLogs.id))
    .limit(1)
    .all()

  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    taskType: row.taskType,
    taskConfig,
    enabled: row.enabled,
    status,
    nextExecution,
    lastRun: latestLog
      ? {
          status: latestLog.status,
          startedAt: latestLog.startedAt,
          durationMs: latestLog.durationMs,
          result: latestLog.result,
          error: latestLog.error,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
