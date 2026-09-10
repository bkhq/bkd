import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { startCron } from '@/cron'
import { db } from '@/db'
import { cronJobs } from '@/db/schema'
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
