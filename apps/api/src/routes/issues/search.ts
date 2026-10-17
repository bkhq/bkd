import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { searchIssueLogs } from '@/db/issue-log-search'
import { issues as issuesTable } from '@/db/schema'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { serializeIssue } from './_shared'

const search = createOpenAPIRouter()

// GET /api/projects/:projectId/issues/search — Find issues by message text
search.openapi(R.searchIssues, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const { q, limit } = c.req.valid('query')
  const hits = searchIssueLogs(project.id, q, limit)
  const rows = hits.length === 0
    ? []
    : await db
        .select()
        .from(issuesTable)
        .where(and(eq(issuesTable.projectId, project.id), inArray(issuesTable.id, hits.map(h => h.issueId))))
  const byId = new Map(rows.map(r => [r.id, r]))

  const data = hits.flatMap(({ issueId, ...hit }) => {
    const row = byId.get(issueId)
    return row ? [{ issue: serializeIssue(row), ...hit }] : []
  })
  return c.json({ success: true, data }, 200 as const)
})

export default search
