import { describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { startCron } from '@/cron'
import { db } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import { del, expectError, expectSuccess, get } from './helpers'
import './setup'

describe('GET /api/cron', () => {
  test('never returns soft-deleted jobs', async () => {
    const suffix = Date.now()
    const [active] = db.insert(cronJobs).values({
      name: `list-active-${suffix}`,
      cron: '0 0 * * * *',
      taskType: 'custom',
      taskConfig: JSON.stringify({ action: 'test' }),
    }).returning().all()
    const [removed] = db.insert(cronJobs).values({
      name: `list-deleted-${suffix}`,
      cron: '0 0 * * * *',
      taskType: 'custom',
      taskConfig: JSON.stringify({ action: 'test' }),
      isDeleted: 1,
    }).returning().all()

    const unpaginated = await get<{ id: string }[]>('/api/cron')
    const jobs = expectSuccess(unpaginated)
    expect(jobs.map(j => j.id)).toContain(active.id)
    expect(jobs.map(j => j.id)).not.toContain(removed.id)
    expect(jobs.find(j => j.id === active.id)).not.toHaveProperty('isDeleted')

    const paginated = await get<{ jobs: { id: string }[] }>('/api/cron?limit=100')
    const page = expectSuccess(paginated).jobs
    expect(page.map(j => j.id)).toContain(active.id)
    expect(page.map(j => j.id)).not.toContain(removed.id)
  })
})

describe('GET /api/cron/:jobId/logs', () => {
  test('returns 404 for a soft-deleted job', async () => {
    const [job] = db.insert(cronJobs).values({
      name: `logs-deleted-${Date.now()}`,
      cron: '0 0 * * * *',
      taskType: 'custom',
      taskConfig: JSON.stringify({ action: 'test' }),
      isDeleted: 1,
    }).returning().all()

    const result = await get(`/api/cron/${job.id}/logs`)

    expect(result.status).toBe(404)
    expect(expectError(result, 404)).toBe('Job not found')
  })
})

describe('DELETE /api/cron/:jobId', () => {
  test('soft-deletes a cron job by id', async () => {
    const [job] = db.insert(cronJobs).values({
      name: `delete-test-${Date.now()}`,
      cron: '0 0 * * * *',
      taskType: 'custom',
      taskConfig: JSON.stringify({ action: 'test' }),
    }).returning().all()

    const result = await del<{ deleted: boolean, name: string }>(`/api/cron/${job.id}`)

    expect(result.status).toBe(200)
    expect(expectSuccess(result)).toEqual({ deleted: true, name: job.name })

    const deleted = db.select().from(cronJobs).where(eq(cronJobs.id, job.id)).get()
    expect(deleted?.isDeleted).toBe(1)

    const repeated = await del(`/api/cron/${job.id}`)
    expect(repeated.status).toBe(404)
    expect(expectError(repeated, 404)).toBe('Job not found')
  })
})

describe('default cron job tombstones', () => {
  test('does not recreate a deleted built-in job on scheduler startup', () => {
    const name = 'upload-cleanup'
    db.delete(cronJobs).where(eq(cronJobs.name, name)).run()
    db.insert(cronJobs).values({
      name,
      cron: '0 0 * * * *',
      taskType: 'builtin',
      taskConfig: JSON.stringify({ action: name }),
      isDeleted: 1,
    }).run()

    const stopCron = startCron()
    try {
      const rows = db.select().from(cronJobs).where(eq(cronJobs.name, name)).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.isDeleted).toBe(1)
    } finally {
      stopCron()
    }
  })
})

describe('DELETE /api/cron/history', () => {
  function job(name: string, values: Partial<typeof cronJobs.$inferInsert> = {}) {
    const [row] = db.insert(cronJobs).values({
      name,
      cron: '0 0 * * * *',
      taskType: 'custom',
      taskConfig: JSON.stringify({ action: 'test' }),
      ...values,
    }).returning().all()
    return row!
  }

  function log(jobId: string, status: 'success' | 'failed' | 'running') {
    const [row] = db.insert(cronJobLogs).values({
      jobId,
      startedAt: new Date(),
      finishedAt: status === 'running' ? null : new Date(),
      status,
    }).returning().all()
    return row!
  }

  const logIds = (jobId: string) =>
    db.select({ id: cronJobLogs.id }).from(cronJobLogs).where(eq(cronJobLogs.jobId, jobId)).all().map(r => r.id)

  test('removes deleted jobs with all their logs and the finished logs of active jobs', async () => {
    const suffix = Date.now()
    const removed = job(`history-deleted-${suffix}`, { isDeleted: 1 })
    log(removed.id, 'success')
    log(removed.id, 'running')
    const active = job(`history-active-${suffix}`)
    log(active.id, 'success')
    log(active.id, 'failed')
    const running = log(active.id, 'running')

    const result = await del<{ jobsDeleted: number, logsDeleted: number }>('/api/cron/history')

    expect(result.status).toBe(200)
    const counts = expectSuccess(result)
    expect(counts.jobsDeleted).toBeGreaterThanOrEqual(1)
    expect(counts.logsDeleted).toBeGreaterThanOrEqual(4)
    expect(db.select().from(cronJobs).where(eq(cronJobs.id, removed.id)).get()).toBeUndefined()
    expect(logIds(removed.id)).toEqual([])
    expect(db.select().from(cronJobs).where(eq(cronJobs.id, active.id)).get()?.isDeleted).toBe(0)
    expect(logIds(active.id)).toEqual([running.id])
  })

  test('is safe to repeat', async () => {
    await del('/api/cron/history')
    const again = await del<{ jobsDeleted: number, logsDeleted: number }>('/api/cron/history')
    expect(expectSuccess(again)).toEqual({ jobsDeleted: 0, logsDeleted: 0 })
  })

  test('a cleaned built-in job is not recreated on scheduler startup', async () => {
    const name = 'log-cleanup'
    db.delete(cronJobLogs).where(inArray(
      cronJobLogs.jobId,
      db.select({ id: cronJobs.id }).from(cronJobs).where(eq(cronJobs.name, name)),
    )).run()
    db.delete(cronJobs).where(eq(cronJobs.name, name)).run()
    job(name, { taskType: 'builtin', taskConfig: JSON.stringify({ action: name }), isDeleted: 1 })

    expectSuccess(await del('/api/cron/history'))
    expect(db.select().from(cronJobs).where(eq(cronJobs.name, name)).all()).toEqual([])

    const stopCron = startCron()
    try {
      expect(db.select().from(cronJobs).where(eq(cronJobs.name, name)).all()).toEqual([])
    } finally {
      stopCron()
    }
  })
})
