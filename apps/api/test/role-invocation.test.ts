import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, createTestIssue, expectError, expectSuccess, post } from './helpers'
import './setup'

let projectId: string
let issueId: string
let roleIssueId: string

describe('Role Invocation', () => {
  beforeAll(async () => {
    projectId = await createTestProject('Role Invocation Project')

    // Create a role issue
    const roleIssueResult = await post(`/api/projects/${projectId}/issues`, {
      title: 'Frontend Expert',
      statusId: 'todo',
      engineType: 'claude-code',
    })
    const roleIssue = expectSuccess(roleIssueResult)
    roleIssueId = roleIssue.id

    // Create main issue
    const mainIssueResult = await post(`/api/projects/${projectId}/issues`, {
      title: 'Main Task',
      statusId: 'todo',
    })
    const mainIssue = expectSuccess(mainIssueResult)
    issueId = mainIssue.id

    // Create internal role
    await post(`/api/projects/${projectId}/roles`, {
      name: 'frontend',
      displayName: '前端专家',
      type: 'internal',
      issueId: roleIssueId,
    })

    // Create external role
    await post(`/api/projects/${projectId}/roles`, {
      name: 'designer',
      displayName: '设计师',
      type: 'external',
      endpoint: 'http://localhost:3001',
      protocol: 'http',
    })
  })

  test('invokeRole returns error for non-existent role', async () => {
    const { invokeRole } = await import('@/engines/issue/role-invoke')

    await expect(
      invokeRole({
        projectId,
        issueId,
        roleName: 'non-existent',
        message: 'test',
      }),
    ).rejects.toThrow("Role 'non-existent' not found")
  })

  test('invokeRole returns error for internal role without issueId', async () => {
    // Create a role without issueId
    const createRes = await post(`/api/projects/${projectId}/roles`, {
      name: 'no-issue',
      displayName: 'No Issue Role',
      type: 'internal',
    })
    expectSuccess(createRes)

    const { invokeRole } = await import('@/engines/issue/role-invoke')

    await expect(
      invokeRole({
        projectId,
        issueId,
        roleName: 'no-issue',
        message: 'test',
      }),
    ).rejects.toThrow("Internal role 'no-issue' has no associated issue")
  })

  test('invokeRole returns error for external role without endpoint', async () => {
    // Create a role without endpoint
    const createRes = await post(`/api/projects/${projectId}/roles`, {
      name: 'no-endpoint',
      displayName: 'No Endpoint Role',
      type: 'external',
    })
    expectSuccess(createRes)

    const { invokeRole } = await import('@/engines/issue/role-invoke')

    await expect(
      invokeRole({
        projectId,
        issueId,
        roleName: 'no-endpoint',
        message: 'test',
      }),
    ).rejects.toThrow("External role 'no-endpoint' has no endpoint")
  })

  test('invokeRole triggers internal role successfully', async () => {
    const { invokeRole } = await import('@/engines/issue/role-invoke')

    const result = await invokeRole({
      projectId,
      issueId,
      roleName: 'frontend',
      message: '帮我设计登录页',
      context: '主 issue 上下文',
    })

    expect(result.type).toBe('internal')
    expect(result.roleId).toBeDefined()
    expect(result.executionId).toBeDefined()
  })

  test('invokeRole handles context correctly', async () => {
    const { invokeRole } = await import('@/engines/issue/role-invoke')

    // This should not throw — the role exists and has an issueId
    const result = await invokeRole({
      projectId,
      issueId,
      roleName: 'frontend',
      message: '测试消息',
      context: '这是上下文信息',
    })

    expect(result.type).toBe('internal')
  })
})
