import { and, asc, eq, sql } from 'drizzle-orm'
import { STATUS_IDS } from '@/config'
import type { StatusId } from '@/config'
import { db } from '@/db'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { createOpenAPIRouter } from '@/openapi/hono'

const stats = createOpenAPIRouter()

interface ProjectStats {
  projectId: string
  projectName: string
  projectAlias: string
  counts: Record<StatusId, number>
  total: number
}

function emptyCounts(): Record<StatusId, number> {
  const out = {} as Record<StatusId, number>
  for (const s of STATUS_IDS) out[s] = 0
  return out
}

// GET /api/issues/stats — per-project status counts across all projects.
stats.get('/', async (c) => {
  // 1) all non-deleted projects (so empty projects appear too)
  const projectRows = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      alias: projectsTable.alias,
      sortOrder: projectsTable.sortOrder,
    })
    .from(projectsTable)
    .where(eq(projectsTable.isDeleted, 0))
    .orderBy(asc(projectsTable.sortOrder), asc(projectsTable.name))

  // 2) GROUP BY (projectId, statusId)
  const aggRows = await db
    .select({
      projectId: issuesTable.projectId,
      statusId: issuesTable.statusId,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(issuesTable)
    .where(and(eq(issuesTable.isDeleted, 0), eq(issuesTable.isHidden, false)))
    .groupBy(issuesTable.projectId, issuesTable.statusId)

  const byProject = new Map<string, Record<StatusId, number>>()
  for (const row of aggRows) {
    const counts = byProject.get(row.projectId) ?? emptyCounts()
    if ((STATUS_IDS as readonly string[]).includes(row.statusId)) {
      counts[row.statusId as StatusId] = Number(row.count)
    }
    byProject.set(row.projectId, counts)
  }

  const data: ProjectStats[] = projectRows.map((p) => {
    const counts = byProject.get(p.id) ?? emptyCounts()
    const total = STATUS_IDS.reduce((acc, s) => acc + counts[s], 0)
    return {
      projectId: p.id,
      projectName: p.name,
      projectAlias: p.alias,
      counts,
      total,
    }
  })

  return c.json({ success: true, data })
})

export default stats
