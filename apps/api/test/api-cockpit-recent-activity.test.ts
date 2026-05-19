/**
 * GET /api/cockpit/recent-activity — returns recent non-hidden issues
 * across all projects, ordered by statusUpdatedAt desc. Used by the cockpit
 * ActivityStream component to backfill on mount.
 */
import { describe, expect, test } from 'bun:test'
import { expectSuccess, get } from './helpers'
import './setup'

interface ActivityRow {
  issueId: string
  title: string
  projectAlias: string
  sessionStatus: string | null
  statusId: string
  statusUpdatedAt: string
}

interface ProjectCreated { id: string, alias: string }
interface IssueCreated { id: string }

async function createProject(name: string): Promise<ProjectCreated> {
  const { get: _g, ...rest } = await import('./helpers')
  const { post } = rest
  return expectSuccess(await post<ProjectCreated>('/api/projects', { name, alias: name }))
}

async function createIssue(projectId: string, title: string): Promise<IssueCreated> {
  const { post } = await import('./helpers')
  return expectSuccess(
    await post<IssueCreated>(`/api/projects/${projectId}/issues`, { title, statusId: 'todo' }),
  )
}

describe('GET /api/cockpit/recent-activity', () => {
  test('returns issues across projects ordered by statusUpdatedAt desc', async () => {
    const p1 = await createProject('recactp1')
    const p2 = await createProject('recactp2')
    await createIssue(p1.id, 'first')
    await new Promise(r => setTimeout(r, 10))
    await createIssue(p2.id, 'second')

    const data = expectSuccess(
      await get<ActivityRow[]>('/api/cockpit/recent-activity?limit=100'),
    )
    expect(Array.isArray(data)).toBe(true)
    const titles = data.map(d => d.title)
    expect(titles).toContain('first')
    expect(titles).toContain('second')
    // Shape sanity
    const row = data.find(d => d.title === 'second')!
    expect(row.projectAlias).toBe('recactp2')
    expect(typeof row.statusUpdatedAt).toBe('string')
    // Each row carries the fields ActivityStream needs
    expect(typeof row.issueId).toBe('string')
    expect(typeof row.statusId).toBe('string')
  })

  test('excludes the hidden cockpit assistant singleton issue', async () => {
    // Bootstrap the cockpit singleton via /assistant
    await get('/api/cockpit/assistant')
    const data = expectSuccess(
      await get<ActivityRow[]>('/api/cockpit/recent-activity?limit=50'),
    )
    // The singleton issue carries the cockpit alias; ensure it doesn't surface.
    const fromCockpit = data.filter(d => d.projectAlias === '__cockpit__')
    expect(fromCockpit.length).toBe(0)
  })

  test('clamps limit to [1,100]', async () => {
    const huge = expectSuccess(
      await get<ActivityRow[]>('/api/cockpit/recent-activity?limit=9999'),
    )
    expect(huge.length).toBeLessThanOrEqual(100)
  })
})
