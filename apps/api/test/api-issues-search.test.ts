import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, sqlite } from '@/db'
import { rebuildIssueLogsFts } from '@/db/issue-log-search'
import { issueLogs } from '@/db/schema'
import { createTestIssue, createTestProject, del, expectError, expectSuccess, get } from './helpers'
/**
 * GET /api/projects/:projectId/issues/search — full-text search over chat
 * messages, one hit per issue.
 */
import './setup'

interface SearchHit {
  issue: { id: string, title: string }
  matchCount: number
  snippet: string
  logId: string
  turnIndex: number
}

let projectId = ''
let otherProjectId = ''
let alpha = ''
let beta = ''
let seq = 0

async function addLog(issueId: string, entryType: string, content: string, opts: { visible?: number, turnIndex?: number } = {}): Promise<string> {
  const id = `01K${String(++seq).padStart(23, '0')}`
  await db.insert(issueLogs).values({
    id,
    issueId,
    entryIndex: seq,
    turnIndex: opts.turnIndex ?? 0,
    entryType,
    content,
    visible: opts.visible ?? 1,
  })
  return id
}

async function search(q: string, pid = projectId): Promise<SearchHit[]> {
  return expectSuccess(await get<SearchHit[]>(`/api/projects/${pid}/issues/search?q=${encodeURIComponent(q)}`))
}

beforeAll(async () => {
  projectId = await createTestProject('Search Project')
  otherProjectId = await createTestProject('Other Search Project')
  alpha = expectSuccess(await createTestIssue(projectId, { title: 'Alpha' })).id as string
  beta = expectSuccess(await createTestIssue(projectId, { title: 'Beta' })).id as string
  const foreign = expectSuccess(await createTestIssue(otherProjectId, { title: 'Foreign' })).id as string

  await addLog(alpha, 'user-message', 'Please fix the flaky reconnect logic')
  await addLog(alpha, 'assistant-message', 'The reconnect backoff now resets.', { turnIndex: 1 })
  await addLog(beta, 'assistant-message', '修复登录跳转问题')
  await addLog(beta, 'tool-use', 'grep zebrafish src/')
  await addLog(beta, 'user-message', 'hidden walrus', { visible: 0 })
  await addLog(foreign, 'user-message', 'reconnect elsewhere')
})

describe('GET /api/projects/:projectId/issues/search', () => {
  test('finds issues by user and agent messages, one hit per issue', async () => {
    const hits = await search('reconnect')
    expect(hits.map(h => h.issue.id)).toEqual([alpha])
    expect(hits[0]!.matchCount).toBe(2)
    expect(hits[0]!.snippet.toLowerCase()).toContain('reconnect')
  })

  test('matches case-insensitively and inside CJK text', async () => {
    expect((await search('RECONNECT')).map(h => h.issue.id)).toEqual([alpha])
    const hits = await search('登录跳')
    expect(hits.map(h => h.issue.id)).toEqual([beta])
    expect(hits[0]!.snippet).toBe('修复登录跳转问题')
  })

  test('falls back for queries shorter than three characters', async () => {
    expect((await search('登录')).map(h => h.issue.id)).toEqual([beta])
  })

  test('ignores tool output and hidden messages', async () => {
    expect(await search('zebrafish')).toEqual([])
    expect(await search('walrus')).toEqual([])
  })

  test('treats FTS syntax as plain text', async () => {
    expect(await search('"reconnect* OR (')).toEqual([])
    expect(await search('a%')).toEqual([])
  })

  test('follows message updates and deletes', async () => {
    const issue = expectSuccess(await createTestIssue(projectId, { title: 'Mutable' })).id as string
    const id = await addLog(issue, 'user-message', 'pelican draft')
    expect((await search('pelican')).map(h => h.issue.id)).toEqual([issue])

    await db.update(issueLogs).set({ visible: 0 }).where(eq(issueLogs.id, id))
    expect(await search('pelican')).toEqual([])

    await db.update(issueLogs).set({ visible: 1, content: 'heron final' }).where(eq(issueLogs.id, id))
    expect(await search('pelican')).toEqual([])
    expect((await search('heron')).map(h => h.issue.id)).toEqual([issue])

    await db.delete(issueLogs).where(eq(issueLogs.id, id))
    expect(await search('heron')).toEqual([])
  })

  test('excludes deleted issues', async () => {
    const issue = expectSuccess(await createTestIssue(projectId, { title: 'Doomed' })).id as string
    await addLog(issue, 'user-message', 'flamingo')
    expect((await search('flamingo')).map(h => h.issue.id)).toEqual([issue])
    expectSuccess(await del(`/api/projects/${projectId}/issues/${issue}`))
    expect(await search('flamingo')).toEqual([])
  })

  test('rebuild restores a stale index', async () => {
    sqlite.run('DELETE FROM issues_logs_fts')
    expect(await search('reconnect')).toEqual([])
    rebuildIssueLogsFts()
    expect((await search('reconnect')).map(h => h.issue.id)).toEqual([alpha])
  })

  test('rejects an empty query and an unknown project', async () => {
    expectError(await get(`/api/projects/${projectId}/issues/search?q=%20`), 400)
    expectError(await get('/api/projects/nope0000/issues/search?q=reconnect'), 404)
  })
})
