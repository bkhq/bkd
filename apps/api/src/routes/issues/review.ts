import { and, desc, eq, inArray } from 'drizzle-orm'
import { STATUS_IDS } from '@/config'
import type { StatusId } from '@/config'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { createOpenAPIRouter } from '@/openapi/hono'
import { serializeIssue } from './_shared'

const review = createOpenAPIRouter()

const VALID_STATUSES = new Set<string>(STATUS_IDS)

function parseStatuses(raw: string | undefined): { ok: true, statuses: StatusId[] } | { ok: false, error: string } {
  if (!raw) return { ok: true, statuses: ['review'] }
  const parts = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return { ok: true, statuses: ['review'] }
  const invalid = parts.filter(p => !VALID_STATUSES.has(p))
  if (invalid.length > 0) {
    return { ok: false, error: `Invalid statuses: ${invalid.join(', ')}` }
  }
  // de-dup while preserving first-seen order
  const seen = new Set<string>()
  const out: StatusId[] = []
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p as StatusId)
    }
  }
  return { ok: true, statuses: out }
}

// GET /api/issues/review[?statuses=working,review]
review.get('/', async (c) => {
  const parsed = parseStatuses(c.req.query('statuses'))
  if (!parsed.ok) {
    return c.json({ success: false, error: parsed.error }, 400)
  }

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
        inArray(issuesTable.statusId, parsed.statuses),
        eq(issuesTable.isDeleted, 0),
        eq(issuesTable.isHidden, false),
        eq(projectsTable.isDeleted, 0),
      ),
    )
    .orderBy(desc(issuesTable.statusUpdatedAt))

  const data = rows.map(r => ({
    ...serializeIssue(r.issue),
    projectName: r.projectName,
    projectAlias: r.projectAlias,
  }))

  return c.json({ success: true, data })
})

export default review
