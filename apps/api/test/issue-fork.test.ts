import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, expectError, expectSuccess, get, post } from './helpers'
/**
 * Issue fork API tests (PLAN-021 / FORK-001).
 */
import './setup'

interface Issue {
  id: string
  statusId: string
  title: string
  parentIssueId: string | null
  forkAwaitingParent: boolean
  useWorktree: boolean
  sessionStatus: string | null
  prompt: string | null
  forks?: Array<{ id: string, issueNumber: number, title: string, statusId: string }>
}

interface ForkResponse {
  issue: Issue
  parentIssueId: string
  mode: string
}

let projectId: string
let parentId: string

beforeAll(async () => {
  projectId = await createTestProject('Fork Test Project')
  const parent = expectSuccess(
    await post<Issue>(`/api/projects/${projectId}/issues`, {
      title: 'Parent issue',
      statusId: 'todo',
    }),
  )
  parentId = parent.id
})

describe('POST /api/projects/:projectId/issues/:issueId/fork', () => {
  test('independent mode creates a child with parentIssueId, no execution', async () => {
    const result = await post<ForkResponse>(
      `/api/projects/${projectId}/issues/${parentId}/fork`,
      { instruction: 'Write the docs', mode: 'independent', autoExecute: false },
    )
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.mode).toBe('independent')
    expect(data.parentIssueId).toBe(parentId)
    expect(data.issue.parentIssueId).toBe(parentId)
    expect(data.issue.statusId).toBe('working')
    expect(data.issue.forkAwaitingParent).toBe(false)
    expect(data.issue.title).toContain('Parent issue')
    expect(data.issue.prompt).toContain('Write the docs')
  })

  test('dependent mode creates a todo child awaiting the parent', async () => {
    const result = await post<ForkResponse>(
      `/api/projects/${projectId}/issues/${parentId}/fork`,
      { instruction: 'Run after parent', mode: 'dependent' },
    )
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.mode).toBe('dependent')
    expect(data.issue.statusId).toBe('todo')
    expect(data.issue.forkAwaitingParent).toBe(true)
    expect(data.issue.sessionStatus).toBeNull()
  })

  test('parent GET reports forked children', async () => {
    const data = expectSuccess(await get<Issue>(`/api/projects/${projectId}/issues/${parentId}`))
    expect(Array.isArray(data.forks)).toBe(true)
    expect(data.forks!.length).toBeGreaterThanOrEqual(2)
  })

  test('parent timeline records a fork-out system message', async () => {
    const data = expectSuccess(
      await get<{ logs: Array<{ entryType: string, content: string }> }>(
        `/api/projects/${projectId}/issues/${parentId}/logs`,
      ),
    )
    const forkOut = data.logs.filter(e => e.entryType === 'system-message')
    expect(forkOut.some(e => e.content.includes('Forked to issue'))).toBe(true)
  })

  test('rejects empty instruction', async () => {
    const result = await post(
      `/api/projects/${projectId}/issues/${parentId}/fork`,
      { instruction: '', mode: 'independent' },
    )
    expectError(result, 400)
  })

  test('returns 404 for unknown issue', async () => {
    const result = await post(
      `/api/projects/${projectId}/issues/nonexist0/fork`,
      { instruction: 'x', mode: 'independent', autoExecute: false },
    )
    expectError(result, 404)
  })
})
