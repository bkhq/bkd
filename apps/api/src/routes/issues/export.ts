import { ExportSchema } from '@/openapi/extra-schemas'
import { errorResponse } from '@/openapi/schemas'
import { createRoute } from '@hono/zod-openapi'
import { and, asc, eq } from 'drizzle-orm'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as z from 'zod'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import type { issuesLogsToolsCall as toolsTable } from '@/db/schema'
import { issueLogs as logsTable } from '@/db/schema'
import { isVisible } from '@/engines/issue/utils/visibility'
import type { NormalizedLogEntry } from '@/engines/types'
import { fetchToolDetails, rowToEntry } from '@/engines/issue/persistence/queries'
import { getProjectOwnedIssue } from './_shared'

const exportRoute = createOpenAPIRouter()

function getAllLogs(issueId: string): NormalizedLogEntry[] {
  const rows = db
    .select()
    .from(logsTable)
    .where(and(eq(logsTable.issueId, issueId), eq(logsTable.visible, 1)))
    .orderBy(asc(logsTable.id))
    .all()

  // Batch in chunks of 500 to avoid SQLite variable limits
  const toolByLogId = new Map<string, (typeof toolsTable)['$inferSelect']>()
  for (let i = 0; i < rows.length; i += 500) {
    for (const [logId, tool] of fetchToolDetails(rows.slice(i, i + 500).map(r => r.id))) toolByLogId.set(logId, tool)
  }

  return rows.map(row => rowToEntry(row, toolByLogId)).filter(isVisible)
}

const exportQuerySchema = z.object({
  format: z.enum(['json']).default('json'),
})

// GET /api/projects/:projectId/issues/:id/export — Export issue logs
exportRoute.openapi(createRoute({
  method: 'get',
  path: '/{id}/export',
  tags: ['Issues'],
  operationId: 'getIssuesExportExport',
  request: { params: z.object({ projectId: z.string().min(1), id: z.string().min(1) }), query: exportQuerySchema },
  responses: {
    200: { description: 'Conversation export', content: { 'application/json': { schema: ExportSchema } } },
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false as const, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false as const, error: 'Issue not found' }, 404)
  }

  const logs = getAllLogs(issueId)
  const filename = `issue-${issue.issueNumber}-${issue.id}`

  c.header('Content-Disposition', `attachment; filename="${filename}.json"`)
  return c.json({ issue: { id: issue.id, title: issue.title, issueNumber: issue.issueNumber }, logs }, 200)
})

export default exportRoute
