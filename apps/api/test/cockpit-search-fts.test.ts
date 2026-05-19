import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import { db, sqlite } from '@/db'
import { issueLogs, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { cockpitSearchLogs } from '@/mcp/cockpit-tools'
import { expectSuccess, get } from './helpers'
import './setup'

let projectId: string
let issueId: string

interface SearchHit {
  logId: string
  content: string
  issueId: string
}

function asJson<T>(r: { content: Array<{ type: string, text?: string }> }): T {
  return JSON.parse(r.content[0]!.text!) as T
}

beforeAll(async () => {
  const [project] = await db
    .insert(projectsTable)
    .values({ name: 'FTS Project', alias: `fts-${Date.now()}` })
    .returning()
  projectId = project.id
  const [issue] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: 'working',
      issueNumber: 1,
      title: 'FTS target',
    })
    .returning()
  issueId = issue.id

  await db.insert(issueLogs).values([
    {
      id: ulid(),
      issueId,
      turnIndex: 0,
      entryIndex: 0,
      entryType: 'assistant-message',
      content: 'I refactored the JWT authentication middleware and added rotation tests.',
    },
    {
      id: ulid(),
      issueId,
      turnIndex: 0,
      entryIndex: 1,
      entryType: 'assistant-message',
      content: 'The websocket reconnect logic needed exponential backoff.',
    },
    {
      id: ulid(),
      issueId,
      turnIndex: 0,
      entryIndex: 2,
      entryType: 'assistant-message',
      content: 'Database migration completed for the user table.',
    },
  ])
})

describe('FTS5 issue_logs_fts shadow', () => {
  test('shadow table exists and backfilled', () => {
    const row = sqlite
      .prepare('SELECT count(*) as c FROM issue_logs_fts')
      .get() as { c: number }
    expect(row.c).toBeGreaterThanOrEqual(3)
  })

  test('insert trigger keeps shadow in sync', async () => {
    const newId = ulid()
    await db.insert(issueLogs).values({
      id: newId,
      issueId,
      turnIndex: 1,
      entryIndex: 0,
      entryType: 'assistant-message',
      content: 'sentinelphrasezxq added for trigger test',
    })
    const row = sqlite
      .prepare('SELECT count(*) as c FROM issue_logs_fts WHERE log_id = ?')
      .get(newId) as { c: number }
    expect(row.c).toBe(1)
  })
})

describe('cockpitSearchLogs (FTS5)', () => {
  test('multi-word query matches log via porter stemming', async () => {
    const out = await cockpitSearchLogs({ query: 'JWT authentication' })
    const data = asJson<SearchHit[]>(out)
    expect(data.length).toBeGreaterThan(0)
    expect(data.some(h => h.content.includes('JWT'))).toBe(true)
  })

  test('returns empty for non-matching query', async () => {
    const out = await cockpitSearchLogs({ query: 'unicornxyz123' })
    const data = asJson<SearchHit[]>(out)
    expect(data.length).toBe(0)
  })

  test('finds the websocket entry by single term', async () => {
    const out = await cockpitSearchLogs({ query: 'websocket' })
    const data = asJson<SearchHit[]>(out)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0].content.toLowerCase()).toContain('websocket')
  })
})

describe('GET /api/search/logs', () => {
  test('returns ranked search hits', async () => {
    const res = await get<SearchHit[]>('/api/search/logs?q=migration')
    const data = expectSuccess(res)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0].content.toLowerCase()).toContain('migration')
  })

  test('400 on empty query', async () => {
    const res = await get('/api/search/logs?q=')
    expect(res.status).toBe(400)
  })
})

// Sanity: hidden issues' logs should not surface
describe('FTS hidden-issue isolation', () => {
  test('logs from hidden issues are excluded from search', async () => {
    const [hidden] = await db
      .insert(issuesTable)
      .values({
        projectId,
        statusId: 'working',
        issueNumber: 99,
        title: 'Hidden internal',
        isHidden: true,
      })
      .returning()
    const sentinel = `hiddensentinelxyz${Date.now()}`
    await db.insert(issueLogs).values({
      id: ulid(),
      issueId: hidden.id,
      turnIndex: 0,
      entryIndex: 0,
      entryType: 'assistant-message',
      content: sentinel,
    })
    const out = await cockpitSearchLogs({ query: sentinel })
    const data = asJson<SearchHit[]>(out)
    expect(data.length).toBe(0)
    // Cleanup not required (test DB is throwaway), but mark hidden gone-ish
    await db.update(issuesTable).set({ isDeleted: 1 }).where(eq(issuesTable.id, hidden.id))
  })
})
