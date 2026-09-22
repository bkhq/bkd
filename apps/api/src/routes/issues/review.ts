import { ReviewIssuesSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import { createRoute } from '@hono/zod-openapi'
import { and, desc, eq } from 'drizzle-orm'
import { createOpenAPIRouter } from '@/openapi/hono'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { serializeIssue } from './_shared'

const review = createOpenAPIRouter()

// GET /api/issues/review — List all review issues across all projects
review.openapi(createRoute({
  method: 'get',
  path: '/',
  tags: ['Issues'],
  operationId: 'getIssuesReview',
  responses: {
    200: successResponse(ReviewIssuesSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const rows = await db
    .select({
      issue: issuesTable,
      projectName: projectsTable.name,
      projectAlias: projectsTable.alias,
    })
    .from(issuesTable)
    .innerJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
    .where(
      and(
        eq(issuesTable.statusId, 'review'),
        eq(issuesTable.isDeleted, 0),
        eq(projectsTable.isDeleted, 0),
      ),
    )
    .orderBy(desc(issuesTable.statusUpdatedAt))

  const data = rows.map(r => ({
    ...serializeIssue(r.issue),
    projectName: r.projectName,
    projectAlias: r.projectAlias,
  }))

  return c.json({ success: true as const, data }, 200)
})

export default review
