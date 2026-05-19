import { beforeAll, describe, expect, test } from 'bun:test'
import { ulid } from 'ulid'
import { db } from '@/db'
import { buildMatchQuery, indexLog, tokenize } from '@/db/fts'
import { issueLogs, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { searchLogs } from '@/mcp/cockpit-tools'
import { expectSuccess, get } from './helpers'
import './setup'

let projectId: string
let issueA: string
let issueB: string

async function insertLog(row: typeof issueLogs.$inferInsert) {
  await db.insert(issueLogs).values(row)
  indexLog(row.id!, row.content!)
}

beforeAll(async () => {
  const [project] = await db
    .insert(projectsTable)
    .values({ name: 'Bigram', alias: `bigram-${Date.now()}` })
    .returning()
  projectId = project.id

  const [a] = await db
    .insert(issuesTable)
    .values({ projectId, statusId: 'working', issueNumber: 1, title: 'Issue A' })
    .returning()
  issueA = a.id
  const [b] = await db
    .insert(issuesTable)
    .values({ projectId, statusId: 'working', issueNumber: 2, title: 'Issue B' })
    .returning()
  issueB = b.id

  await insertLog({
    id: ulid(),
    issueId: issueA,
    turnIndex: 0,
    entryIndex: 0,
    entryType: 'assistant-message',
    content: '今天我修复了全文检索的中文分词问题，搜索质量明显提升。',
  })
  await insertLog({
    id: ulid(),
    issueId: issueA,
    turnIndex: 0,
    entryIndex: 1,
    entryType: 'assistant-message',
    content: '另外还重构了 websocket 重连逻辑。',
  })
  await insertLog({
    id: ulid(),
    issueId: issueB,
    turnIndex: 0,
    entryIndex: 0,
    entryType: 'assistant-message',
    content: '在另一个 issue 里也讨论了全文检索的需求。',
  })
})

describe('bigram tokenizer', () => {
  test('CJK splits into overlapping bigrams', () => {
    expect(tokenize('全文检索')).toEqual(['全文', '文检', '检索'])
  })
  test('mixed ASCII + CJK lower-cases and bigrams', () => {
    expect(tokenize('Hello 全文')).toEqual(['hello', '全文'])
  })
  test('single CJK char emits itself', () => {
    expect(tokenize('查')).toEqual(['查'])
  })
  test('buildMatchQuery joins with AND and prefixes the last token', () => {
    const q = buildMatchQuery('全文检索')
    expect(q).toContain(' AND ')
    expect(q.endsWith('*')).toBe(true)
  })
})

describe('CJK search', () => {
  test('finds Chinese phrase across multiple issues', () => {
    const hits = searchLogs('全文检索')
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits.every(h => h.content.includes('全文检索'))).toBe(true)
  })

  test('issueId filter scopes results to a single issue', () => {
    const hits = searchLogs('全文检索', 30, { issueId: issueA })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits.every(h => h.issueId === issueA)).toBe(true)
  })

  test('English term still works after bigram migration', () => {
    const hits = searchLogs('websocket')
    expect(hits.some(h => h.content.toLowerCase().includes('websocket'))).toBe(true)
  })
})

describe('GET /api/search/logs with issueId filter', () => {
  test('issueId query param scopes search', async () => {
    const res = await get<Array<{ issueId: string }>>(
      `/api/search/logs?q=${encodeURIComponent('全文检索')}&issueId=${issueB}`,
    )
    const data = expectSuccess(res)
    expect(data.length).toBeGreaterThanOrEqual(1)
    expect(data.every(h => h.issueId === issueB)).toBe(true)
  })
})
