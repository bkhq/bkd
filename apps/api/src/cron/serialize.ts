import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import type { cronJobs } from '@/db/schema'
import { cronJobLogs } from '@/db/schema'
import { getBaker } from './index'

export interface LastRun {
  status: string
  startedAt: string
  durationMs: number | null
  result: string | null
  error: string | null
}

export interface SerializedCronJob {
  id: string
  name: string
  cron: string
  taskType: string
  taskConfig: Record<string, unknown>
  enabled: boolean
  status: string
  nextExecution: string | null
  lastRun: LastRun | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
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

  // Fetch latest log entry for lastRun
  let lastRun: LastRun | null = null
  const [latestLog] = db
    .select({
      status: cronJobLogs.status,
      startedAt: cronJobLogs.startedAt,
      durationMs: cronJobLogs.durationMs,
      result: cronJobLogs.result,
      error: cronJobLogs.error,
    })
    .from(cronJobLogs)
    .where(eq(cronJobLogs.jobId, row.id))
    .orderBy(desc(cronJobLogs.id))
    .limit(1)
    .all()

  if (latestLog) {
    lastRun = {
      status: latestLog.status,
      startedAt: latestLog.startedAt,
      durationMs: latestLog.durationMs,
      result: latestLog.result,
      error: latestLog.error,
    }
  }

  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    taskType: row.taskType,
    taskConfig,
    enabled: row.enabled,
    status,
    nextExecution,
    lastRun,
    isDeleted: row.isDeleted === 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
