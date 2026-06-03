import { beforeAll, describe, expect, test } from 'bun:test'
import app from '@/app'
import { createTestProject, patch, post } from './helpers'
/**
 * Keyset pagination for GET /api/projects/:projectId/issues.
 */
import './setup'

interface IssueLite { id: string, issueNumber: number, isPinned: boolean }
interface ListResponse {
  success: boolean
  data: IssueLite[]
  nextCursor: string | null
  hasMore: boolean
  error?: string
}

async function listIssues(pid: string, qs = ''): Promise<{ status: number, json: ListResponse }> {
  const res = await app.request(`http://localhost/api/projects/${pid}/issues${qs}`)
  const json = (await res.json()) as ListResponse
  return { status: res.status, json }
}

async function collectAllPages(pid: string, limit: number): Promise<string[]> {
  const collected: string[] = []
  let cursor: string | null = null
  let guard = 0
  do {
    const qs = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const { json } = await listIssues(pid, qs)
    expect(json.data.length).toBeLessThanOrEqual(limit)
    collected.push(...json.data.map(i => i.id))
    cursor = json.nextCursor
    if (++guard > 50) throw new Error('pagination did not terminate')
  } while (cursor)
  return collected
}

const TOTAL = 5
let projectId: string

beforeAll(async () => {
  projectId = await createTestProject('Pagination Test Project')
  for (let i = 0; i < TOTAL; i++) {
    await post(`/api/projects/${projectId}/issues`, { title: `Issue ${i}`, statusId: 'todo' })
  }
})

describe('GET /api/projects/:projectId/issues — pagination', () => {
  test('without limit returns the full list (backward compatible)', async () => {
    const { status, json } = await listIssues(projectId)
    expect(status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.length).toBe(TOTAL)
    expect(json.hasMore).toBe(false)
    expect(json.nextCursor).toBeNull()
  })

  test('limit caps the page and sets hasMore + nextCursor', async () => {
    const { json } = await listIssues(projectId, '?limit=2')
    expect(json.data.length).toBe(2)
    expect(json.hasMore).toBe(true)
    expect(json.nextCursor).toBeTruthy()
  })

  test('keyset traversal yields every issue once, in the full-list order', async () => {
    const full = (await listIssues(projectId)).json.data.map(i => i.id)
    const collected = await collectAllPages(projectId, 2)
    expect(collected).toEqual(full)
    expect(new Set(collected).size).toBe(TOTAL)
  })

  test('pinned issues sort first and pagination stays consistent', async () => {
    const before = (await listIssues(projectId)).json.data
    const target = before[before.length - 1]! // an older issue, currently last
    await patch(`/api/projects/${projectId}/issues/${target.id}`, { isPinned: true })

    const full = (await listIssues(projectId)).json.data
    expect(full[0]!.id).toBe(target.id)
    expect(full[0]!.isPinned).toBe(true)

    const collected = await collectAllPages(projectId, 2)
    expect(collected).toEqual(full.map(i => i.id))
  })

  test('invalid cursor returns 400', async () => {
    const { status, json } = await listIssues(projectId, '?limit=2&cursor=%%%not-valid%%%')
    expect(status).toBe(400)
    expect(json.success).toBe(false)
  })
})
