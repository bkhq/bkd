import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { expectSuccess, get } from './helpers'
import './setup'

interface SingletonResponse {
  project: { id: string, alias: string, isArchived: number }
  issueId: string
  isFresh: boolean
}

interface AssistantResponse {
  issueId: string
  projectId: string
  projectAlias: string
}

describe('GET /api/cockpit/_singleton', () => {
  test('creates the archived __cockpit__ project + hidden assistant issue on first call', async () => {
    const res = await get<SingletonResponse>('/api/cockpit/_singleton')
    const data = expectSuccess(res)

    expect(data.project.alias).toBe('__cockpit__')
    expect(data.project.isArchived).toBe(1)
    expect(data.issueId).toBeTruthy()
    expect(data.isFresh).toBe(true)

    // Verify issue is hidden and in the cockpit project
    const [row] = await db
      .select({
        projectId: issuesTable.projectId,
        isHidden: issuesTable.isHidden,
        title: issuesTable.title,
      })
      .from(issuesTable)
      .where(eq(issuesTable.id, data.issueId))
    expect(row).toBeDefined()
    expect(row!.projectId).toBe(data.project.id)
    expect(row!.isHidden).toBe(true)
    expect(row!.title).toContain('Cockpit')
  })

  test('subsequent calls return the same singleton (idempotent)', async () => {
    const first = expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    const second = expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    expect(second.project.id).toBe(first.project.id)
    expect(second.issueId).toBe(first.issueId)
    expect(second.isFresh).toBe(false)
  })

  test('the cockpit project does not appear in /api/projects default listing', async () => {
    expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    const list = await get<Array<{ alias: string }>>('/api/projects')
    const aliases = expectSuccess(list).map(p => p.alias)
    expect(aliases).not.toContain('__cockpit__')
  })
})

describe('GET /api/cockpit/assistant', () => {
  test('returns the singleton assistant pointer', async () => {
    const res = await get<AssistantResponse>('/api/cockpit/assistant')
    const data = expectSuccess(res)
    expect(data.projectAlias).toBe('__cockpit__')
    expect(data.issueId).toBeTruthy()

    // Verify it matches the singleton from /_singleton
    const singleton = expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    expect(data.issueId).toBe(singleton.issueId)
    expect(data.projectId).toBe(singleton.project.id)
  })
})

describe('Cockpit hidden issue isolation', () => {
  test('the cockpit issue does not surface in /api/issues/review (any status filter)', async () => {
    const singleton = expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    const res = await get<Array<{ id: string }>>(
      '/api/issues/review?statuses=todo,working,review,done',
    )
    const ids = expectSuccess(res).map(i => i.id)
    expect(ids).not.toContain(singleton.issueId)
  })

  test('the cockpit issue does not surface in /api/issues/stats counts', async () => {
    const singleton = expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    const stats = expectSuccess(
      await get<Array<{ projectId: string, total: number }>>('/api/issues/stats'),
    )
    const cockpit = stats.find(p => p.projectId === singleton.project.id)
    // Either absent (project filtered out for non-archived listing — current impl
    // keeps it because stats doesn't filter isArchived) or total === 0 because
    // the only issue is hidden. We check the looser invariant.
    if (cockpit) {
      expect(cockpit.total).toBe(0)
    }
  })
})
