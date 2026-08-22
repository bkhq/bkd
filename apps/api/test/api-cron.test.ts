import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { startCron } from '@/cron'
import { db } from '@/db'
import { cronJobs } from '@/db/schema'
import { del, expectError, expectSuccess } from './helpers'
import './setup'

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
