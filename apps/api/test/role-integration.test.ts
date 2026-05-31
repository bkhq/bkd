import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { createTestProject, expectSuccess, post } from './helpers'
import './setup'

// Mock issueEngine to avoid real AI execution
mock.module('@/engines/issue', () => ({
  issueEngine: {
    executeIssue: mock(() => ({ executionId: 'mock', messageId: 'mock' })),
    isTurnInFlight: mock(() => false),
    getLogs: mock(() => ({ entries: [], hasMore: false })),
    getMaxTurnIndex: mock(() => 0),
    getLogsAround: mock(() => ({ entries: [], hasMore: false })),
  },
}))

let projectId: string
let issueId: string
let frontendRoleId: string
let backendRoleId: string

describe('Role Integration', () => {
  beforeAll(async () => {
    projectId = await createTestProject('Role Integration Project')

    // Create main issue
    const mainIssueResult = await post(`/api/projects/${projectId}/issues`, {
      title: '实现登录功能',
      statusId: 'working',
      engineType: 'claude-code',
    })
    const mainIssue = expectSuccess(mainIssueResult)
    issueId = mainIssue.id

    // Create frontend role issue
    const frontendIssueResult = await post(`/api/projects/${projectId}/issues`, {
      title: 'Frontend Expert',
      statusId: 'todo',
      engineType: 'claude-code',
    })
    const frontendIssue = expectSuccess(frontendIssueResult)

    // Create backend role issue
    const backendIssueResult = await post(`/api/projects/${projectId}/issues`, {
      title: 'Backend Expert',
      statusId: 'todo',
      engineType: 'claude-code',
    })
    const backendIssue = expectSuccess(backendIssueResult)

    // Create frontend role
    const frontendRoleResult = await post(`/api/projects/${projectId}/roles`, {
      name: 'frontend',
      displayName: '前端专家',
      type: 'internal',
      issueId: frontendIssue.id,
    })
    const frontendRole = expectSuccess(frontendRoleResult)
    frontendRoleId = frontendRole.id

    // Create backend role
    const backendRoleResult = await post(`/api/projects/${projectId}/roles`, {
      name: 'backend',
      displayName: '后端专家',
      type: 'internal',
      issueId: backendIssue.id,
    })
    const backendRole = expectSuccess(backendRoleResult)
    backendRoleId = backendRole.id
  })

  test('full flow: user @frontend triggers role execution', async () => {
    // Mock fetch for external callback simulation
    globalThis.fetch = mock(() => Promise.resolve({ ok: true, status: 200 } as Response)) as any

    // Send follow-up with @mention
    const result = await post(`/api/projects/${projectId}/issues/${issueId}/follow-up`, {
      prompt: '帮我设计登录页 @frontend',
    })

    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.issueId).toBe(issueId)
  })

  test('role reply callback writes to issue logs', async () => {
    const replyResult = await post(`/api/projects/${projectId}/issues/${issueId}/roles/reply`, {
      role: 'frontend',
      message: '建议用 React + Tailwind',
    })

    expect(replyResult.status).toBe(200)
    const replyData = expectSuccess(replyResult)
    expect(replyData.content).toBe('建议用 React + Tailwind')

    // Verify log appears in issue logs by querying DB directly
    const { db } = await import('@/db')
    const { issueLogs } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const logs = await db.select().from(issueLogs).where(eq(issueLogs.issueId, issueId))

    const hasReply = logs.some((entry: any) =>
      entry.content === '建议用 React + Tailwind',
    )
    expect(hasReply).toBe(true)
  })

  test('role reply includes isRoleReply metadata', async () => {
    await post(`/api/projects/${projectId}/issues/${issueId}/roles/reply`, {
      role: 'frontend',
      message: '前端方案完成',
    })

    // Query database directly
    const { db } = await import('@/db')
    const { issueLogs } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const logs = await db.select().from(issueLogs).where(eq(issueLogs.issueId, issueId))

    const roleEntry = logs.find((entry: any) =>
      entry.content === '前端方案完成',
    )

    expect(roleEntry).toBeDefined()
    expect(roleEntry.metadata).toBeDefined()

    const metadata = JSON.parse(roleEntry.metadata)
    expect(metadata.isRoleReply).toBe(true)
    expect(metadata.role).toBe('frontend')
  })
})
