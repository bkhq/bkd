import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, expectSuccess, post } from './helpers'
import './setup'

let projectId: string
let issueId: string

describe('Role Reply Callback', () => {
  beforeAll(async () => {
    projectId = await createTestProject('Role Reply Project')

    const issueResult = await post(`/api/projects/${projectId}/issues`, {
      title: 'Main Task',
      statusId: 'todo',
    })
    const issue = expectSuccess(issueResult)
    issueId = issue.id

    // Create external role
    await post(`/api/projects/${projectId}/roles`, {
      name: 'designer',
      displayName: '设计师',
      type: 'external',
      endpoint: 'http://localhost:3001',
      protocol: 'http',
    })
  })

  test('POST /roles/reply writes to issue logs', async () => {
    const result = await post(`/api/projects/${projectId}/issues/${issueId}/roles/reply`, {
      role: 'designer',
      message: '建议用蓝色作为主色调',
    })

    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.content).toBe('建议用蓝色作为主色调')
    expect(data.entryType).toBe('assistant-message')
  })

  test('role reply is visible in issue logs', async () => {
    // First add a reply
    await post(`/api/projects/${projectId}/issues/${issueId}/roles/reply`, {
      role: 'designer',
      message: '测试回复消息',
    })

    // Verify by querying the database directly
    const { db } = await import('@/db')
    const { issueLogs } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const logs = await db.select().from(issueLogs).where(eq(issueLogs.issueId, issueId))

    const hasRoleReply = logs.some((entry: any) =>
      entry.content === '测试回复消息' && entry.entryType === 'assistant-message',
    )

    expect(hasRoleReply).toBe(true)
  })

  test('role reply includes metadata', async () => {
    const result = await post(`/api/projects/${projectId}/issues/${issueId}/roles/reply`, {
      role: 'frontend',
      message: '前端建议',
    })

    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.metadata).toBeDefined()

    const metadata = JSON.parse(data.metadata)
    expect(metadata.role).toBe('frontend')
    expect(metadata.isRoleReply).toBe(true)
  })
})
