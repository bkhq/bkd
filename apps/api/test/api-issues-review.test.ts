import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, expectError, expectSuccess, get, patch, post } from './helpers'
import './setup'

interface ReviewIssue {
  id: string
  statusId: string
  projectId: string
  projectName: string
  projectAlias: string
}

let projectId: string
const issueIds: Record<string, string> = {}

beforeAll(async () => {
  projectId = await createTestProject('Review Filter Project')
  // Create one issue in each status by creating todo then patching status.
  for (const status of ['todo', 'working', 'review', 'done']) {
    const create = await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: `Issue ${status}`,
      statusId: 'todo',
    })
    const { id } = expectSuccess(create)
    if (status !== 'todo') {
      const up = await patch<{ id: string }>(`/api/projects/${projectId}/issues/${id}`, {
        statusId: status,
      })
      expectSuccess(up)
    }
    issueIds[status] = id
  }
})

describe('GET /api/issues/review', () => {
  test('defaults to review-only (back-compat)', async () => {
    const res = await get<ReviewIssue[]>('/api/issues/review')
    const data = expectSuccess(res)
    const ids = data.map(i => i.id)
    expect(ids).toContain(issueIds.review)
    expect(ids).not.toContain(issueIds.todo)
    expect(ids).not.toContain(issueIds.working)
    expect(ids).not.toContain(issueIds.done)
    // attached project metadata
    expect(data.every(i => i.projectName && i.projectAlias)).toBe(true)
  })

  test('?statuses=working,review returns both', async () => {
    const res = await get<ReviewIssue[]>('/api/issues/review?statuses=working,review')
    const data = expectSuccess(res)
    const ids = data.map(i => i.id)
    expect(ids).toContain(issueIds.working)
    expect(ids).toContain(issueIds.review)
    expect(ids).not.toContain(issueIds.todo)
    expect(ids).not.toContain(issueIds.done)
  })

  test('?statuses=todo,working,review,done returns all', async () => {
    const res = await get<ReviewIssue[]>('/api/issues/review?statuses=todo,working,review,done')
    const data = expectSuccess(res)
    const ids = data.map(i => i.id)
    expect(ids).toContain(issueIds.todo)
    expect(ids).toContain(issueIds.working)
    expect(ids).toContain(issueIds.review)
    expect(ids).toContain(issueIds.done)
  })

  test('rejects invalid status value', async () => {
    const res = await get('/api/issues/review?statuses=bogus')
    expectError(res, 400)
  })

  test('tolerates whitespace and ignores empty entries', async () => {
    const res = await get<ReviewIssue[]>('/api/issues/review?statuses=%20working%20,%20,review')
    const data = expectSuccess(res)
    const ids = data.map(i => i.id)
    expect(ids).toContain(issueIds.working)
    expect(ids).toContain(issueIds.review)
  })
})
