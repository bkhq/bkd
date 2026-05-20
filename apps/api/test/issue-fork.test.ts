import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, expectError, expectSuccess, get, post } from './helpers'
/**
 * Issue fork API tests (PLAN-021 / FORK-002).
 *
 * Coverage focuses on the `after-parent` path — it has no filesystem side
 * effects. The `now` path's worktree seeding is covered by worktree.test.ts
 * and worktree-carry.test.ts.
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
  runWhen: string
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
  test('after-parent mode creates a todo child awaiting the parent', async () => {
    const result = await post<ForkResponse>(
      `/api/projects/${projectId}/issues/${parentId}/fork`,
      { instruction: 'Run after the parent finishes', runWhen: 'after-parent' },
    )
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.runWhen).toBe('after-parent')
    expect(data.parentIssueId).toBe(parentId)
    expect(data.issue.parentIssueId).toBe(parentId)
    expect(data.issue.statusId).toBe('todo')
    expect(data.issue.forkAwaitingParent).toBe(true)
    expect(data.issue.sessionStatus).toBeNull()
    expect(data.issue.useWorktree).toBe(true)
    expect(data.issue.title).toContain('Parent issue')
    expect(data.issue.prompt).toContain('Run after the parent finishes')
  })

  test('parent GET reports forked children', async () => {
    const data = expectSuccess(await get<Issue>(`/api/projects/${projectId}/issues/${parentId}`))
    expect(Array.isArray(data.forks)).toBe(true)
    expect(data.forks!.length).toBeGreaterThanOrEqual(1)
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
      { instruction: '', runWhen: 'after-parent' },
    )
    expectError(result, 400)
  })

  test('rejects an invalid runWhen', async () => {
    const result = await post(
      `/api/projects/${projectId}/issues/${parentId}/fork`,
      { instruction: 'x', runWhen: 'whenever' },
    )
    expectError(result, 400)
  })

  test('returns 404 for unknown issue', async () => {
    const result = await post(
      `/api/projects/${projectId}/issues/nonexist0/fork`,
      { instruction: 'x', runWhen: 'after-parent' },
    )
    expectError(result, 404)
  })
})
