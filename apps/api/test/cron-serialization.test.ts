import { expect, spyOn, test } from 'bun:test'
import { inArray } from 'drizzle-orm'
import { serializeJobs } from '@/cron/serialize'
import { db, sqlite } from '@/db'
import { cronJobLogs, cronJobs } from '@/db/schema'
import './setup'

test('loads the latest run for a page of jobs in one query', () => {
  const rows = db.insert(cronJobs).values(Array.from({ length: 10 }, (_, i) => ({
    name: `batch-serialize-${i}`,
    cron: '0 * * * *',
    taskType: 'custom',
    taskConfig: '{}',
    enabled: false,
  }))).returning().all()
  const ids = rows.map(row => row.id)
  db.insert(cronJobLogs).values(rows.slice(0, 9).flatMap((row, i) => [
    { id: String(i * 2).padStart(26, '0'), jobId: row.id, startedAt: new Date(1000), status: 'failed', result: 'older' },
    { id: String(i * 2 + 1).padStart(26, '0'), jobId: row.id, startedAt: new Date(2000), status: 'success', result: 'latest' },
  ])).run()
  const prepare = spyOn(sqlite, 'prepare')
  try {
    const serialized = serializeJobs(rows)
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(1)
    expect(serialized.slice(0, 9).map(row => row.lastRun?.result)).toEqual(new Array(9).fill('latest'))
    expect(serialized[9]?.lastRun).toBeNull()
  } finally {
    prepare.mockRestore()
    db.delete(cronJobLogs).where(inArray(cronJobLogs.jobId, ids)).run()
    db.delete(cronJobs).where(inArray(cronJobs.id, ids)).run()
  }
})
