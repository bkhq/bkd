import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, del, expectSuccess, get, patch, post } from './helpers'
import './setup'

let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Role Test Project')
})

describe('Role CRUD', () => {
  test('POST creates a role', async () => {
    const result = await post(`/api/projects/${projectId}/roles`, {
      name: 'frontend',
      displayName: '前端专家',
      type: 'internal',
      issueId: 'test-issue-id',
    })
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.name).toBe('frontend')
    expect(data.displayName).toBe('前端专家')
  })

  test('GET lists roles', async () => {
    const result = await get(`/api/projects/${projectId}/roles`)
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.length).toBeGreaterThan(0)
  })

  test('PATCH updates role', async () => {
    const createRes = await post(`/api/projects/${projectId}/roles`, {
      name: 'backend',
      displayName: '后端专家',
      type: 'internal',
    })
    const role = expectSuccess(createRes)

    const updateRes = await patch(`/api/projects/${projectId}/roles/${role.id}`, {
      displayName: '后端开发',
    })
    expect(updateRes.status).toBe(200)
    const updated = expectSuccess(updateRes)
    expect(updated.displayName).toBe('后端开发')
  })

  test('DELETE soft deletes role', async () => {
    const createRes = await post(`/api/projects/${projectId}/roles`, {
      name: 'designer',
      displayName: '设计师',
      type: 'external',
      endpoint: 'http://localhost:3001',
    })
    const role = expectSuccess(createRes)

    const delRes = await del(`/api/projects/${projectId}/roles/${role.id}`)
    expect(delRes.status).toBe(200)
  })
})
