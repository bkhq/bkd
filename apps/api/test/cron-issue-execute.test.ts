import { beforeAll, describe, expect, test } from 'bun:test'
import '@/cron/actions'
import { getActionHandler } from '@/cron/actions/registry'
import { createTestIssue, createTestProject, expectSuccess, get, waitFor } from './helpers'
import './setup'

interface Issue {
  id: string
  statusId: string
  sessionStatus: string | null
  [key: string]: unknown
}

let projectId: string

async function reviewIssue(title: string): Promise<string> {
  const { id } = expectSuccess(
    await createTestIssue(projectId, { title, statusId: 'working', engineType: 'codex' }),
  ) as Issue
  await waitFor(async () => {
    const issue = expectSuccess(await get<Issue>(`/api/projects/${projectId}/issues/${id}`))
    return issue.statusId === 'review'
  })
  return id
}

beforeAll(async () => {
  projectId = await createTestProject('Cron Execute Project')
})

describe('issue-execute cron action', () => {
  test('starts an execution on a review issue', async () => {
    const issueId = await reviewIssue('Cron execute')
    const result = await getActionHandler('issue-execute')!({ projectId, issueId, prompt: 'again' })
    expect(result).toContain('execution started')
  })

  test('rejects an engine with no executor, as the execute route does', async () => {
    const issueId = await reviewIssue('Cron bad engine')
    await expect(
      getActionHandler('issue-execute')!({ projectId, issueId, prompt: 'again', engineType: 'no-such-engine' }),
    ).rejects.toThrow('Unknown engine type: no-such-engine')
  })

  test('refuses a todo issue', async () => {
    const { id } = expectSuccess(await createTestIssue(projectId, { title: 'Cron todo' })) as Issue
    await expect(
      getActionHandler('issue-execute')!({ projectId, issueId: id, prompt: 'go' }),
    ).rejects.toThrow('todo')
  })
})
