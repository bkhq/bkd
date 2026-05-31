import { describe, expect, test } from 'bun:test'
import { del, expectError, expectSuccess, get, patch, post } from './helpers'
import './setup'

interface Workspace {
  id: string
  name: string
  description?: string
  repos: { url: string, defaultBranch: string, role: string }[]
  createdAt: string
  updatedAt: string
}

describe('POST /api/workspaces', () => {
  test('creates a workspace with name and repos', async () => {
    const result = await post<Workspace>('/api/workspaces', {
      name: 'Test Workspace',
      description: 'A test',
      repos: [{ url: 'git@github.com:test/repo.git', defaultBranch: 'main', role: 'backend' }],
    })
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.name).toBe('Test Workspace')
    expect(data.id).toBeTruthy()
    expect(data.repos).toHaveLength(1)
    expect(data.repos[0]!.url).toBe('git@github.com:test/repo.git')
    expect(data.repos[0]!.defaultBranch).toBe('main')
    expect(data.repos[0]!.role).toBe('backend')
  })

  test('creates a workspace with name only (repos defaults to [])', async () => {
    const result = await post<Workspace>('/api/workspaces', {
      name: 'Minimal Workspace',
    })
    expect(result.status).toBe(201)
    const data = expectSuccess(result)
    expect(data.name).toBe('Minimal Workspace')
    expect(data.repos).toEqual([])
  })

  test('rejects empty name', async () => {
    const result = await post<Workspace>('/api/workspaces', { name: '' })
    expect(result.status).toBe(400)
  })

  test('rejects missing name', async () => {
    const result = await post<Workspace>('/api/workspaces', {})
    expect(result.status).toBe(400)
  })
})

describe('GET /api/workspaces', () => {
  test('lists workspaces', async () => {
    await post<Workspace>('/api/workspaces', {
      name: `List Test ${Date.now()}`,
    })
    const result = await get<Workspace[]>('/api/workspaces')
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })
})

describe('GET /api/workspaces/:id', () => {
  test('gets a workspace by id', async () => {
    const created = expectSuccess(
      await post<Workspace>('/api/workspaces', { name: 'GetById' }),
    )
    const result = await get<Workspace>(`/api/workspaces/${created.id}`)
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.id).toBe(created.id)
    expect(data.name).toBe('GetById')
  })

  test('returns 404 for nonexistent workspace', async () => {
    const result = await get<Workspace>('/api/workspaces/nonexistent')
    expect(result.status).toBe(404)
    expectError(result, 404)
  })
})

describe('PATCH /api/workspaces/:id', () => {
  test('updates workspace name', async () => {
    const created = expectSuccess(
      await post<Workspace>('/api/workspaces', { name: 'BeforeUpdate' }),
    )
    const result = await patch<Workspace>(`/api/workspaces/${created.id}`, {
      name: 'AfterUpdate',
    })
    expect(result.status).toBe(200)
    const data = expectSuccess(result)
    expect(data.name).toBe('AfterUpdate')
  })

  test('updates workspace description', async () => {
    const created = expectSuccess(
      await post<Workspace>('/api/workspaces', { name: 'DescWS' }),
    )
    const result = await patch<Workspace>(`/api/workspaces/${created.id}`, {
      description: 'Updated description',
    })
    const data = expectSuccess(result)
    expect(data.description).toBe('Updated description')
  })

  test('returns 404 for nonexistent workspace', async () => {
    const result = await patch<Workspace>('/api/workspaces/nonexistent', {
      name: 'Update',
    })
    expect(result.status).toBe(404)
    expectError(result, 404)
  })
})

describe('DELETE /api/workspaces/:id', () => {
  test('soft-deletes workspace and excludes it from listing', async () => {
    const created = expectSuccess(
      await post<Workspace>('/api/workspaces', {
        name: `Delete WS ${Date.now()}`,
      }),
    )

    const result = await del<{ id: string }>(`/api/workspaces/${created.id}`)
    expect(result.status).toBe(200)
    expect(expectSuccess(result).id).toBe(created.id)

    const getDeleted = await get<Workspace>(`/api/workspaces/${created.id}`)
    expect(getDeleted.status).toBe(404)

    const list = expectSuccess(await get<Workspace[]>('/api/workspaces'))
    expect(list.some(w => w.id === created.id)).toBe(false)
  })
})
