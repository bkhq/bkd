import { describe, expect, test } from 'bun:test'
import { and, eq, inArray } from 'drizzle-orm'
import app from '@/app'
import { db, sqlite } from '@/db'
import { cronJobs, issueLogs, issues, notes } from '@/db/schema'
import { createTestIssue, createTestProject, expectSuccess, post } from './helpers'
import './setup'

describe('SQLite write atomicity', () => {
  test('creates concurrent issues with distinct consecutive numbers', async () => {
    const projectId = await createTestProject('Concurrent creation')
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) =>
      createTestIssue(projectId, { title: `Concurrent ${i}`, engineType: 'codex' })))
    expect(results.map(r => r.status)).toEqual([201, 201, 201, 201, 201])
    const rows = db.select().from(issues).where(eq(issues.projectId, projectId)).all()
    expect(rows.map(r => r.issueNumber).sort()).toEqual([1, 2, 3, 4, 5])
  })

  test('rolls back a duplicated issue when copying its messages fails', async () => {
    const projectId = await createTestProject('Duplicate rollback')
    const source = expectSuccess(await createTestIssue(projectId, { engineType: 'codex' }))
    db.insert(issueLogs).values({
      issueId: source.id as string,
      entryIndex: 0,
      entryType: 'user-message',
      content: 'Original',
    }).run()
    sqlite.run(`CREATE TEMP TRIGGER audit_fail_copy BEFORE INSERT ON issues_logs
      WHEN NEW.issue_id <> '${source.id}'
      BEGIN SELECT RAISE(ABORT, 'forced copy failure'); END`)
    try {
      const result = await post(`/api/projects/${projectId}/issues/${source.id}/duplicate`, {})
      expect(result.status).toBe(500)
      const rows = db.select().from(issues).where(eq(issues.projectId, projectId)).all()
      expect(rows.map(r => r.id)).toEqual([source.id as string])
    } finally {
      sqlite.run('DROP TRIGGER audit_fail_copy')
    }
  })
})

describe('Cron keyset ordering', () => {
  test('traverses timestamps and random IDs without duplicates or omissions', async () => {
    const ids = ['audit-aa', 'audit-zz', 'audit-mm']
    db.insert(cronJobs).values(ids.map((id, i) => ({
      id,
      name: id,
      cron: '0 * * * *',
      taskType: 'custom',
      taskConfig: '{}',
      enabled: false,
      createdAt: new Date(Date.UTC(2099, 0, 1) - (i === 0 ? 0 : 1000)),
    }))).run()
    try {
      let cursor: string | null = null
      const collected: string[] = []
      for (let i = 0; i < 3; i++) {
        const response = await app.request(`/api/cron?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
        const { data } = await response.json()
        collected.push(...data.jobs.map((job: { id: string }) => job.id))
        cursor = data.nextCursor
      }
      expect(collected).toEqual(['audit-aa', 'audit-zz', 'audit-mm'])
    } finally {
      db.delete(cronJobs).where(inArray(cronJobs.id, ids)).run()
    }
  })

  test('rejects malformed cursors', async () => {
    const res = await app.request('/api/cron?limit=1&cursor=not-a-cursor')
    expect(res.status).toBe(400)
  })
})

describe('API request boundaries', () => {
  test('returns a request ID for correlating failures with server logs', async () => {
    const res = await app.request('/api/not-found')
    expect(res.status).toBe(404)
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9A-Z]{26}$/)
  })
  test('bounds the default issue page and exposes a continuation cursor', async () => {
    const projectId = await createTestProject('Bounded board')
    db.insert(issues).values(Array.from({ length: 101 }, (_, i) => ({
      projectId,
      title: `Issue ${i}`,
      statusId: 'todo',
      sortOrder: 'a0',
      issueNumber: i + 1,
    }))).run()
    const res = await app.request(`/api/projects/${projectId}/issues`)
    const body = await res.json()
    expect(body.data).toHaveLength(100)
    expect(body.hasMore).toBe(true)
    expect(body.nextCursor).toEqual(expect.any(String))
  })
  test('maps malformed JSON to a client error', async () => {
    const res = await app.request('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false, error: expect.any(String) })
  })

  test('rejects unsupported media types without inserting a note', async () => {
    const before = db.select().from(notes).all().length
    const res = await app.request('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{"title":"note"}',
    })
    expect(res.status).toBe(415)
    expect(db.select().from(notes).all()).toHaveLength(before)
  })

  test('uses a string error for invalid export parameters', async () => {
    const res = await app.request('/api/projects/missing/issues/missing/export?format=invalid')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false, error: expect.any(String) })
  })

  test('applies follow-up length limits to multipart fields', async () => {
    const projectId = await createTestProject('Multipart validation')
    const issue = expectSuccess(await createTestIssue(projectId, { engineType: 'codex' }))
    for (const fields of [
      { prompt: 'x'.repeat(32769) },
      { prompt: 'valid', displayPrompt: 'x'.repeat(501) },
    ]) {
      const body = new FormData()
      for (const [key, value] of Object.entries(fields)) body.set(key, value)
      const res = await app.request(`/api/projects/${projectId}/issues/${issue.id}/follow-up`, {
        method: 'POST',
        body,
      })
      expect(res.status).toBe(400)
    }
    expect(db.select().from(issueLogs).where(and(
      eq(issueLogs.issueId, issue.id as string),
      eq(issueLogs.entryType, 'user-message'),
    )).all()).toHaveLength(0)
  })

  test('permits PUT preflight for configuration endpoints', async () => {
    const res = await app.request('/api/engines/virtual', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'PUT',
      },
    })
    expect(res.headers.get('access-control-allow-methods')?.split(',')).toContain('PUT')
  })
})
