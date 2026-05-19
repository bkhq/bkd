import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import type {
  CockpitTimelineMessage,
  CockpitTimelineMessageKind,
} from '@bkd/shared'
import { createTestProject, expectError, expectSuccess, get, post } from './helpers'
import './setup'

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Merge Issue Test Project')
})

async function newIssue(statusId: 'todo' | 'working' | 'review' | 'done') {
  const res = await post<{ id: string }>(
    `/api/projects/${projectId}/issues`,
    { title: `m-${Date.now()}-${Math.random()}`, statusId: 'todo' },
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

describe('cockpit proposal — merge_issue', () => {
  test('flips review → done via /execute endpoint', async () => {
    const id = await newIssue('review')
    const res = await post<{ proposalId: string, status: string }>(
      '/api/cockpit/proposals/execute',
      { type: 'merge_issue', params: { issueId: id } },
    )
    const data = expectSuccess(res)
    expect(data.status).toBe('approved')
    expect(await statusOf(id)).toBe('done')
  })

  test('rejects when issue is not in review', async () => {
    const id = await newIssue('working')
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'merge_issue',
      params: { issueId: id },
    })
    expectError(res, 400)
    expect(await statusOf(id)).toBe('working')
  })

  test('rejects when issue does not exist', async () => {
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'merge_issue',
      params: { issueId: 'no-such-issue' },
    })
    expectError(res, 400)
  })

  test('rejects unknown proposal type', async () => {
    const res = await post('/api/cockpit/proposals/execute', {
      type: 'nope_destroy_world',
      params: {},
    })
    expectError(res, 400)
  })
})

describe('cockpit timeline routes', () => {
  test('GET /api/cockpit/timeline returns messages + counts envelope', async () => {
    const res = await get<{
      messages: CockpitTimelineMessage[]
      counts: Record<CockpitTimelineMessageKind, number>
    }>('/api/cockpit/timeline')
    const data = expectSuccess(res)
    expect(Array.isArray(data.messages)).toBe(true)
    expect(data.counts).toMatchObject({
      suggest_merge: expect.any(Number),
      alert_off_track: expect.any(Number),
      ack: expect.any(Number),
      info: expect.any(Number),
    })
  })

  test('POST /api/cockpit/timeline/:id/ack returns 404 for unknown id', async () => {
    const res = await post('/api/cockpit/timeline/nonexistent/ack', {})
    expectError(res, 404)
  })

  test('POST /api/cockpit/timeline/:id/dismiss returns 404 for unknown id', async () => {
    const res = await post('/api/cockpit/timeline/nonexistent/dismiss', {})
    expectError(res, 404)
  })

  test('POST /api/cockpit/timeline/:id/snooze rejects invalid body', async () => {
    const res = await post('/api/cockpit/timeline/anything/snooze', { untilMs: -1 })
    expectError(res, 400)
  })
})
