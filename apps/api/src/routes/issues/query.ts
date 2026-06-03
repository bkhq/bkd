import type { SQL } from 'drizzle-orm'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import type { IssueRow } from './_shared'
import { getProjectOwnedIssue, serializeIssue } from './_shared'

const query = createOpenAPIRouter()

// Keyset cursor for the (isPinned DESC, statusUpdatedAt DESC, issueNumber DESC)
// ordering. statusUpdatedAt is stored at second resolution; issueNumber is the
// unique tiebreaker that makes the ordering total.
interface IssueCursor { p: number, t: number, n: number }

function encodeCursor(row: IssueRow): string {
  const payload: IssueCursor = {
    p: row.isPinned ? 1 : 0,
    t: Math.floor(row.statusUpdatedAt.getTime() / 1000),
    n: row.issueNumber,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeCursor(raw: string): IssueCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown
    if (
      obj && typeof obj === 'object'
      && typeof (obj as IssueCursor).p === 'number'
      && typeof (obj as IssueCursor).t === 'number'
      && typeof (obj as IssueCursor).n === 'number'
    ) {
      return obj as IssueCursor
    }
    return null
  } catch {
    return null
  }
}

// Rows strictly "after" the cursor under the DESC ordering.
function keysetCondition(cur: IssueCursor): SQL | undefined {
  const pinned = cur.p === 1
  const date = new Date(cur.t * 1000)
  return or(
    lt(issuesTable.isPinned, pinned),
    and(eq(issuesTable.isPinned, pinned), lt(issuesTable.statusUpdatedAt, date)),
    and(
      eq(issuesTable.isPinned, pinned),
      eq(issuesTable.statusUpdatedAt, date),
      lt(issuesTable.issueNumber, cur.n),
    ),
  )
}

// GET /api/projects/:projectId/issues — List issues.
// Without `limit`, returns the full list (default). With `limit`, returns a
// keyset page plus `nextCursor`/`hasMore`; pass `cursor` to fetch the next page.
query.openapi(R.listIssues, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const { limit, cursor } = c.req.valid('query')

  let keyset: SQL | undefined
  if (cursor) {
    const decoded = decodeCursor(cursor)
    if (!decoded) {
      return c.json({ success: false, error: 'Invalid cursor' }, 400 as const)
    }
    keyset = keysetCondition(decoded)
  }

  const where = and(
    eq(issuesTable.projectId, project.id),
    eq(issuesTable.isDeleted, 0),
    keyset,
  )

  let q = db
    .select()
    .from(issuesTable)
    .where(where)
    .orderBy(
      desc(issuesTable.isPinned),
      desc(issuesTable.statusUpdatedAt),
      desc(issuesTable.issueNumber),
    )
    .$dynamic()

  // Over-fetch by one to detect whether a further page exists.
  if (limit !== undefined) {
    q = q.limit(limit + 1)
  }

  const rows = await q
  const hasMore = limit !== undefined && rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]!) : null

  return c.json({
    success: true,
    data: pageRows.map(r => serializeIssue(r)),
    nextCursor,
    hasMore,
  }, 200 as const)
})

// GET /api/projects/:projectId/issues/:issueId — Get single issue
query.openapi(R.getIssue, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404 as const)
  }

  return c.json({
    success: true,
    data: serializeIssue(issue),
  }, 200 as const)
})

export default query
