import { and, eq } from 'drizzle-orm'
import { describe, expect, test } from 'bun:test'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { createTestProject, createTestIssue, expectSuccess, get } from './helpers'
import './setup'

interface TreeIssue {
  id: string
  title: string
  statusId: string
  issueNumber: number
  parentIssueId: string | null
  children: TreeIssue[]
}

describe('GET /api/projects/:projectId/issues?tree=true', () => {
  test('returns nested tree structure', async () => {
    const projectId = await createTestProject('Tree Test Project')

    const parent = expectSuccess(await createTestIssue(projectId, { title: 'Parent' }))
    const child = expectSuccess(await createTestIssue(projectId, { title: 'Child' }))

    // Set parentIssueId via direct DB update (not exposed via PATCH API)
    await db
      .update(issuesTable)
      .set({ parentIssueId: parent.id })
      .where(and(eq(issuesTable.id, child.id), eq(issuesTable.projectId, projectId)))

    const result = await get<TreeIssue[]>(`/api/projects/${projectId}/issues?tree=true`)
    const data = expectSuccess(result)
    expect(Array.isArray(data)).toBe(true)

    const parentNode = data.find(n => n.id === parent.id)
    expect(parentNode).toBeDefined()
    expect(parentNode!.children).toHaveLength(1)
    expect(parentNode!.children[0]!.id).toBe(child.id)
  })

  test('returns empty array for project with no issues', async () => {
    const projectId = await createTestProject('Empty Tree Project')
    const result = await get<TreeIssue[]>(`/api/projects/${projectId}/issues?tree=true`)
    const data = expectSuccess(result)
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(0)
  })

  test('returns flat list when tree is not set', async () => {
    const projectId = await createTestProject('Flat List Project')
    await createTestIssue(projectId, { title: 'Issue 1' })

    const result = await get(`/api/projects/${projectId}/issues`)
    const data = expectSuccess(result)
    expect(Array.isArray(data)).toBe(true)
    // Flat responses should have individual issue fields, not children
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty('id')
    expect(data[0]).not.toHaveProperty('children')
  })
})
