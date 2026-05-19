import { beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@/db'
import { issueLogs, issues, projects } from '@/db/schema'
import {
  cockpitGetIssue,
  cockpitGetStats,
  cockpitListIssues,
  cockpitRecentActivity,
  cockpitSearchLogs,
} from '@/mcp/cockpit-tools'
import { ulid } from 'ulid'
import './setup'

let alphaId: string
let betaId: string
let workingIssueId: string
let reviewIssueId: string

beforeAll(async () => {
  const [alpha] = await db
    .insert(projects)
    .values({ name: 'Tools Alpha', alias: `tools-alpha-${Date.now()}` })
    .returning()
  alphaId = alpha.id
  const [beta] = await db
    .insert(projects)
    .values({ name: 'Tools Beta', alias: `tools-beta-${Date.now()}` })
    .returning()
  betaId = beta.id

  // alpha: 1 working, 1 review, 1 done
  const [working] = await db
    .insert(issues)
    .values({
      projectId: alphaId,
      statusId: 'working',
      issueNumber: 1,
      title: 'Refactor auth flow',
      prompt: 'Refactor auth',
    })
    .returning()
  workingIssueId = working.id
  const [review] = await db
    .insert(issues)
    .values({
      projectId: alphaId,
      statusId: 'review',
      issueNumber: 2,
      title: 'Add login tests',
    })
    .returning()
  reviewIssueId = review.id
  await db.insert(issues).values({
    projectId: alphaId,
    statusId: 'done',
    issueNumber: 3,
    title: 'Bump deps',
  })
  // beta: 1 todo
  await db.insert(issues).values({
    projectId: betaId,
    statusId: 'todo',
    issueNumber: 1,
    title: 'Plan v2 roadmap',
  })

  // a few logs on the working issue
  await db.insert(issueLogs).values([
    {
      id: ulid(),
      issueId: workingIssueId,
      turnIndex: 0,
      entryIndex: 0,
      entryType: 'user-message',
      content: 'please refactor the auth flow to use JWT',
    },
    {
      id: ulid(),
      issueId: workingIssueId,
      turnIndex: 0,
      entryIndex: 1,
      entryType: 'assistant-message',
      content: 'analyzing the current auth implementation',
    },
  ])
})

function asText(result: { content: Array<{ type: string, text?: string }> }): string {
  const first = result.content[0]
  if (first?.type !== 'text' || !first.text) throw new Error('expected text content')
  return first.text
}

function asJson<T>(result: { content: Array<{ type: string, text?: string }> }): T {
  return JSON.parse(asText(result)) as T
}

describe('cockpitGetStats', () => {
  test('returns per-project status counts', async () => {
    const out = await cockpitGetStats()
    const data = asJson<Array<{ projectId: string, counts: Record<string, number>, total: number }>>(out)
    const alpha = data.find(p => p.projectId === alphaId)!
    expect(alpha.counts.working).toBe(1)
    expect(alpha.counts.review).toBe(1)
    expect(alpha.counts.done).toBe(1)
    expect(alpha.total).toBe(3)
  })
})

describe('cockpitListIssues', () => {
  test('returns all issues without filter', async () => {
    const out = await cockpitListIssues({})
    const data = asJson<Array<{ id: string, statusId: string }>>(out)
    const ids = data.map(i => i.id)
    expect(ids).toContain(workingIssueId)
    expect(ids).toContain(reviewIssueId)
  })

  test('filters by statuses', async () => {
    const out = await cockpitListIssues({ statuses: ['review'] })
    const data = asJson<Array<{ id: string, statusId: string }>>(out)
    expect(data.every(i => i.statusId === 'review')).toBe(true)
    expect(data.map(i => i.id)).toContain(reviewIssueId)
    expect(data.map(i => i.id)).not.toContain(workingIssueId)
  })

  test('filters by projectId', async () => {
    const out = await cockpitListIssues({ projectId: betaId })
    const data = asJson<Array<{ projectId: string }>>(out)
    expect(data.every(i => i.projectId === betaId)).toBe(true)
  })

  test('respects limit', async () => {
    const out = await cockpitListIssues({ limit: 1 })
    const data = asJson<unknown[]>(out)
    expect(data.length).toBe(1)
  })

  test('excludes hidden issues', async () => {
    const [hidden] = await db
      .insert(issues)
      .values({
        projectId: alphaId,
        statusId: 'working',
        issueNumber: 99,
        title: 'Hidden internal',
        isHidden: true,
      })
      .returning()
    const out = await cockpitListIssues({})
    const data = asJson<Array<{ id: string }>>(out)
    expect(data.map(i => i.id)).not.toContain(hidden.id)
  })
})

describe('cockpitGetIssue', () => {
  test('returns issue detail by id', async () => {
    const out = await cockpitGetIssue({ issueId: workingIssueId })
    const data = asJson<{ id: string, title: string, projectName: string }>(out)
    expect(data.id).toBe(workingIssueId)
    expect(data.title).toBe('Refactor auth flow')
    expect(data.projectName).toBe('Tools Alpha')
  })

  test('returns error for unknown id', async () => {
    const out = await cockpitGetIssue({ issueId: 'doesnotexist' })
    expect(asText(out)).toMatch(/not found/i)
  })
})

describe('cockpitRecentActivity', () => {
  test('returns recent log entries with issue context', async () => {
    const out = await cockpitRecentActivity({ limit: 5 })
    const data = asJson<Array<{ issueId: string, entryType: string, content: string }>>(out)
    expect(data.length).toBeGreaterThan(0)
    const hit = data.find(e => e.issueId === workingIssueId)
    expect(hit).toBeDefined()
  })
})

describe('cockpitSearchLogs', () => {
  test('finds log entries by substring', async () => {
    const out = await cockpitSearchLogs({ query: 'JWT' })
    const data = asJson<Array<{ issueId: string, content: string }>>(out)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0].content.toLowerCase()).toContain('jwt')
  })

  test('returns empty array on no match', async () => {
    const out = await cockpitSearchLogs({ query: 'zzznever-matches-zzz' })
    const data = asJson<unknown[]>(out)
    expect(data.length).toBe(0)
  })
})
