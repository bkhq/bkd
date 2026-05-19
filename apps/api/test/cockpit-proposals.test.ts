import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { proposalStore } from '@/cockpit/proposals'
import { createTestProject, expectError, expectSuccess, get, post } from './helpers'
import './setup'

interface Proposal {
  id: string
  type: string
  summary: string
  params: Record<string, unknown>
  status: string
}

let projectId: string
let issueId: string

beforeAll(async () => {
  projectId = await createTestProject('Proposals Test Project')
  const created = await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
    title: 'Target issue',
    statusId: 'todo',
  })
  issueId = expectSuccess(created).id
})

beforeEach(() => {
  proposalStore.clear()
})

describe('GET /api/cockpit/proposals', () => {
  test('returns empty array initially', async () => {
    const res = await get<Proposal[]>('/api/cockpit/proposals')
    expect(expectSuccess(res)).toEqual([])
  })

  test('returns proposed actions', async () => {
    proposalStore.propose('cancel_issue', { issueId: 'x' }, 'Cancel x')
    const res = await get<Proposal[]>('/api/cockpit/proposals')
    const data = expectSuccess(res)
    expect(data.length).toBe(1)
    expect(data[0].type).toBe('cancel_issue')
    expect(data[0].status).toBe('pending')
  })
})

describe('POST /api/cockpit/proposals/:id/approve', () => {
  test('returns 404 for unknown id', async () => {
    const res = await post('/api/cockpit/proposals/nonexistent/approve', {})
    expectError(res, 404)
  })

  test('approves and dispatches a bulk status update', async () => {
    // create two more issues to bulk-move
    const a = expectSuccess(await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'A',
      statusId: 'todo',
    }))
    const b = expectSuccess(await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'B',
      statusId: 'todo',
    }))
    const p = proposalStore.propose(
      'bulk_update_status',
      { issueIds: [a.id, b.id], statusId: 'review' },
      'Move A,B to review',
    )

    const res = await post<{ status: string }>(`/api/cockpit/proposals/${p.id}/approve`, {})
    const data = expectSuccess(res)
    expect(data.status).toBe('approved')

    const rows = await db
      .select({ id: issuesTable.id, statusId: issuesTable.statusId })
      .from(issuesTable)
      .where(eq(issuesTable.projectId, projectId))
    const aRow = rows.find(r => r.id === a.id)
    const bRow = rows.find(r => r.id === b.id)
    expect(aRow?.statusId).toBe('review')
    expect(bRow?.statusId).toBe('review')
  })

  test('approves a create_issue proposal', async () => {
    const p = proposalStore.propose(
      'create_issue',
      { projectId, title: 'AI-suggested issue', statusId: 'todo' },
      'Create AI-suggested issue',
    )
    const res = await post<{ status: string, result: { id: string } }>(
      `/api/cockpit/proposals/${p.id}/approve`,
      {},
    )
    const data = expectSuccess(res)
    expect(data.status).toBe('approved')
    expect(data.result.id).toBeTruthy()
    const [created] = await db
      .select({ title: issuesTable.title })
      .from(issuesTable)
      .where(eq(issuesTable.id, data.result.id))
    expect(created?.title).toBe('AI-suggested issue')
  })

  test('cannot approve twice (second call rejects)', async () => {
    const p = proposalStore.propose(
      'create_issue',
      { projectId, title: 'Once', statusId: 'todo' },
      'Create Once',
    )
    expectSuccess(await post(`/api/cockpit/proposals/${p.id}/approve`, {}))
    const second = await post(`/api/cockpit/proposals/${p.id}/approve`, {})
    expectError(second, 409)
  })
})

describe('POST /api/cockpit/proposals/:id/reject', () => {
  test('marks the proposal rejected without dispatching', async () => {
    const p = proposalStore.propose('cancel_issue', { issueId }, 'Cancel target')
    const res = await post<{ status: string }>(`/api/cockpit/proposals/${p.id}/reject`, {})
    const data = expectSuccess(res)
    expect(data.status).toBe('rejected')
    // The issue must still exist + not be cancelled
    const [row] = await db
      .select({ statusId: issuesTable.statusId })
      .from(issuesTable)
      .where(eq(issuesTable.id, issueId))
    expect(row?.statusId).toBe('todo')
  })
})

describe('proposalStore TTL', () => {
  test('expired proposals are not returned by get/listPending', async () => {
    const p = proposalStore.propose('cancel_issue', { issueId: 'x' }, 'x')
    // simulate expiry by mutating createdAt directly (private field via index)
    const internal = proposalStore as unknown as { map: Map<string, { createdAt: number }> }
    const rec = internal.map.get(p.id)!
    rec.createdAt = Date.now() - 31 * 60 * 1000
    expect(proposalStore.get(p.id)).toBeUndefined()
    expect(proposalStore.listPending().some(x => x.id === p.id)).toBe(false)
  })
})

describe('archived/hidden source project guard', () => {
  test('create_issue cannot target a deleted project', async () => {
    const [tmp] = await db
      .insert(projectsTable)
      .values({ name: 'Deleted', alias: `del-${Date.now()}`, isDeleted: 1 })
      .returning({ id: projectsTable.id })
    const p = proposalStore.propose(
      'create_issue',
      { projectId: tmp.id, title: 'X', statusId: 'todo' },
      'X',
    )
    const res = await post(`/api/cockpit/proposals/${p.id}/approve`, {})
    expectError(res, 400)
  })
})
