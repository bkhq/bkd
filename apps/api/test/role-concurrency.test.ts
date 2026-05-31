import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createTestProject, expectSuccess, post } from './helpers'
import './setup'

// Mock issueEngine.executeIssue to track concurrent calls
let concurrentExecutions = 0
let maxConcurrent = 0

const mockExecuteIssue = mock(({ issueId }: { issueId: string }) => {
  concurrentExecutions++
  maxConcurrent = Math.max(maxConcurrent, concurrentExecutions)

  // Simulate async execution
  return new Promise((resolve) => {
    setTimeout(() => {
      concurrentExecutions--
      resolve({
        executionId: `mock-exec-${issueId}`,
        messageId: `mock-msg-${issueId}`,
      })
    }, 100)
  })
})

mock.module('@/engines/issue', () => ({
  issueEngine: {
    executeIssue: mockExecuteIssue,
    isTurnInFlight: mock(() => false),
    getLogs: mock(() => ({ entries: [], hasMore: false })),
    getMaxTurnIndex: mock(() => 0),
    getLogsAround: mock(() => ({ entries: [], hasMore: false })),
  },
}))

let projectId: string
let issueId: string

describe('Role Concurrency', () => {
  beforeAll(async () => {
    projectId = await createTestProject('Role Concurrency Project')

    // Create main issue
    const mainIssueResult = await post(`/api/projects/${projectId}/issues`, {
      title: '并发测试',
      statusId: 'working',
    })
    const mainIssue = expectSuccess(mainIssueResult)
    issueId = mainIssue.id

    // Create multiple role issues
    const roles = ['frontend', 'backend', 'designer']
    for (const roleName of roles) {
      const roleIssueResult = await post(`/api/projects/${projectId}/issues`, {
        title: `${roleName} Expert`,
        statusId: 'todo',
      })
      const roleIssue = expectSuccess(roleIssueResult)

      await post(`/api/projects/${projectId}/roles`, {
        name: roleName,
        displayName: `${roleName} 专家`,
        type: 'internal',
        issueId: roleIssue.id,
      })
    }
  })

  beforeEach(() => {
    concurrentExecutions = 0
    maxConcurrent = 0
    mockExecuteIssue.mockClear()
  })

  test('parallel invocation of multiple roles', async () => {
    const { invokeRole } = await import('@/engines/issue/role-invoke')

    // Invoke all three roles in parallel
    const results = await Promise.all([
      invokeRole({ projectId, issueId, roleName: 'frontend', message: '设计UI' }),
      invokeRole({ projectId, issueId, roleName: 'backend', message: '实现API' }),
      invokeRole({ projectId, issueId, roleName: 'designer', message: '设计配色' }),
    ])

    // All should succeed
    expect(results).toHaveLength(3)
    expect(results.every(r => r.type === 'internal')).toBe(true)

    // Should have executed concurrently
    expect(maxConcurrent).toBeGreaterThan(1)
  })

  test('sequential invocation of same role is queued', async () => {
    const { invokeRole } = await import('@/engines/issue/role-invoke')

    // Invoke same role twice in parallel
    const results = await Promise.all([
      invokeRole({ projectId, issueId, roleName: 'frontend', message: '任务1' }),
      invokeRole({ projectId, issueId, roleName: 'frontend', message: '任务2' }),
    ])

    // Both should succeed (queued by withIssueLock)
    expect(results).toHaveLength(2)
    expect(results.every(r => r.type === 'internal')).toBe(true)
  })

  test('role invocation count matches', async () => {
    const { invokeRole } = await import('@/engines/issue/role-invoke')

    await Promise.all([
      invokeRole({ projectId, issueId, roleName: 'frontend', message: '1' }),
      invokeRole({ projectId, issueId, roleName: 'backend', message: '2' }),
      invokeRole({ projectId, issueId, roleName: 'designer', message: '3' }),
    ])

    // Should have called executeIssue 3 times
    expect(mockExecuteIssue).toHaveBeenCalledTimes(3)
  })
})
