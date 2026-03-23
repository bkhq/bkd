import { Hono } from 'hono'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { getBaker } from '@/cron'

const cronRoute = new Hono()

function serializeJob(row: typeof cronJobs.$inferSelect) {
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
    taskConfig: JSON.parse(row.taskConfig),
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

// GET /api/cron — list all cron jobs
cronRoute.get('/', (c) => {
  const rows = db
    .select()
    .from(cronJobs)
    .where(eq(cronJobs.isDeleted, 0))
    .all()

  return c.json({ success: true, data: rows.map(serializeJob) })
})

// GET /api/cron/:jobId/logs — get logs for a specific job
cronRoute.get('/:jobId/logs', (c) => {
  const jobId = c.req.param('jobId')
  const { status, limit: limitStr, cursor } = c.req.query()

  // Verify job exists
  const [job] = db
    .select()
    .from(cronJobs)
    .where(and(eq(cronJobs.id, jobId), eq(cronJobs.isDeleted, 0)))
    .all()

  if (!job) {
    return c.json({ success: false, error: 'Job not found' }, 404)
  }

  const pageLimit = Math.min(Math.max(Number(limitStr) || 20, 1), 100)
  const conditions = [eq(cronJobLogs.jobId, jobId)]

  if (status) {
    conditions.push(eq(cronJobLogs.status, status))
  }

  if (cursor) {
    conditions.push(lt(cronJobLogs.id, cursor))
  }

  const logs = db
    .select()
    .from(cronJobLogs)
    .where(and(...conditions))
    .orderBy(desc(cronJobLogs.id))
    .limit(pageLimit + 1)
    .all()

  const hasMore = logs.length > pageLimit
  const page = hasMore ? logs.slice(0, pageLimit) : logs
  const nextCursor = hasMore ? page.at(-1)!.id : null

  return c.json({
    success: true,
    data: {
      jobName: job.name,
      logs: page.map(log => ({
        id: log.id,
        startedAt: log.startedAt,
        finishedAt: log.finishedAt,
        durationMs: log.durationMs,
        status: log.status,
        result: log.result,
        error: log.error,
      })),
      hasMore,
      nextCursor,
    },
  })
})

export default cronRoute
