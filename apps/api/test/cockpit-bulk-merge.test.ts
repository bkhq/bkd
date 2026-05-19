import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { createTestProject, expectError, expectSuccess, post } from './helpers'
import './setup'

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Bulk Merge Test Project')
})

async function newIssue(statusId: 'todo' | 'working' | 'review' | 'done') {
  const res = await post<{ id: string }>(
    `/api/projects/${projectId}/issues`,
    { title: `b-${Date.now()}-${Math.random()}`, statusId: 'todo' },
  )
  const id = expectSuccess(res).id
  if (statusId !== 'todo') {
    await db
      .update(issuesTable)
      .set({ statusId, statusUpdatedAt: new Date() })
      .where(eq(issuesTable.id, id))
  }
  return id
}

async function statusOf(id: string) {
  const [row] = await db
    .select({ statusId: issuesTable.statusId })
    .from(issuesTable)
    .where(and(eq(issuesTable.id, id), eq(issuesTable.isDeleted, 0)))
  return row?.statusId
}

describe('cockpit proposal — bulk_merge', () => {
  test('flips all selected review issues to done', async () => {
    const a = await newIssue('review')
    const b = await newIssue('review')
    const res = await post<{ proposalId: string, status: string }>(
      '/api/cockpit/proposals/execute',
      { type: 'bulk_merge', params: { issueIds: [a, b] } },
    )
    expectSuccess(res)
    expect(await statusOf(a)).toBe('done')
    expect(await statusOf(b)).toBe('done')
  })

  test('rejects when any issue is not in review', async () => {
    const a = await newIssue('review')
    const b = await newIssue('working')
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'bulk_merge',
      params: { issueIds: [a, b] },
    })
    expectError(res, 400)
    // Neither issue moves on rejection
    expect(await statusOf(a)).toBe('review')
    expect(await statusOf(b)).toBe('working')
  })

  test('caps at 5 issues per call', async () => {
    const ids: string[] = []
    for (let i = 0; i < 6; i++) ids.push(await newIssue('review'))
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'bulk_merge',
      params: { issueIds: ids },
    })
    expectError(res, 400)
  })

  test('rejects empty issueIds', async () => {
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'bulk_merge',
      params: { issueIds: [] },
    })
    expectError(res, 400)
  })
})

describe('cockpit proposal — send_reply', () => {
  test('rejects empty body', async () => {
    const id = await newIssue('review')
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'send_reply',
      params: { issueId: id, body: '   ' },
    })
    expectError(res, 400)
  })

  test('rejects unknown issue', async () => {
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'send_reply',
      params: { issueId: 'no-such', body: 'yes please' },
    })
    expectError(res, 400)
  })

  test('rejects oversized body', async () => {
    const id = await newIssue('review')
    const big = 'x'.repeat(8001)
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'send_reply',
      params: { issueId: id, body: big },
    })
    expectError(res, 400)
  })
})
