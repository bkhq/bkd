import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, del, expectError, expectSuccess, get, patch, post } from './helpers'
import './setup'

let projectId: string
let issueId: string

beforeAll(async () => {
  projectId = await createTestProject('Role CRUD Edge Case Project')
  const issueResult = await post(`/api/projects/${projectId}/issues`, {
    title: 'Test Issue',
    statusId: 'todo',
  })
  const issue = expectSuccess(issueResult)
  issueId = issue.id
})

describe('Role CRUD Edge Cases', () => {
  test('POST duplicate role name returns 409', async () => {
    await post(`/api/projects/${projectId}/roles`, {
      name: 'duplicate-test',
      displayName: 'Test Role',
      type: 'internal',
    })

    const result = await post(`/api/projects/${projectId}/roles`, {
      name: 'duplicate-test',
      displayName: 'Another Test',
      type: 'internal',
    })

    expect(result.status).toBe(409)
    expectError(result)
  })

  test('GET non-existent role returns 404', async () => {
    const result = await get(`/api/projects/${projectId}/roles/non-existent-id`)
    expect(result.status).toBe(404)
    expectError(result)
  })

  test('PATCH non-existent role returns 404', async () => {
    const result = await patch(`/api/projects/${projectId}/roles/non-existent-id`, {
      displayName: 'Updated',
    })
    expect(result.status).toBe(404)
    expectError(result)
  })

  test('DELETE non-existent role returns 404', async () => {
    const result = await del(`/api/projects/${projectId}/roles/non-existent-id`)
    expect(result.status).toBe(404)
    expectError(result)
  })

  test('GET deleted role is not in list', async () => {
    const createRes = await post(`/api/projects/${projectId}/roles`, {
      name: 'to-delete',
      displayName: 'To Delete',
      type: 'internal',
    })
    const role = expectSuccess(createRes)

    await del(`/api/projects/${projectId}/roles/${role.id}`)

    const listRes = await get(`/api/projects/${projectId}/roles`)
    const roles = expectSuccess(listRes)
    const found = roles.find((r: any) => r.id === role.id)
    expect(found).toBeUndefined()
  })
})
