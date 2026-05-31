import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { getProjectOwnedIssue, serializeIssue } from './_shared'
import type { IssueRow } from './_shared'

const query = createOpenAPIRouter()

interface TreeIssue {
  id: string
  title: string
  statusId: string
  issueNumber: number
  parentIssueId: string | null
  children: TreeIssue[]
}

function buildIssueTree(issues: IssueRow[]): TreeIssue[] {
  const map = new Map<string, TreeIssue>()
  const roots: TreeIssue[] = []

  for (const issue of issues) {
    map.set(issue.id, {
      id: issue.id,
      title: issue.title,
      statusId: issue.statusId,
      issueNumber: issue.issueNumber,
      parentIssueId: issue.parentIssueId ?? null,
      children: [],
    })
  }
  for (const issue of issues) {
    const node = map.get(issue.id)!
    if (issue.parentIssueId && map.has(issue.parentIssueId)) {
      map.get(issue.parentIssueId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// GET /api/projects/:projectId/issues — List issues
query.openapi(R.listIssues, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as const)
  }

  const rows = await db
    .select()
    .from(issuesTable)
    .where(and(
      eq(issuesTable.projectId, project.id),
      eq(issuesTable.isDeleted, 0),
      eq(issuesTable.isHidden, false),
    ))
    .orderBy(desc(issuesTable.isPinned), desc(issuesTable.statusUpdatedAt))

  if (c.req.query('tree') === 'true') {
    const tree = buildIssueTree(rows)
    return c.json({ success: true, data: tree }, 200 as const)
  }

  return c.json({
    success: true,
    data: rows.map(r => serializeIssue(r)),
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

  // Child issues forked from this one (lineage chip).
  const forkRows = await db
    .select({
      id: issuesTable.id,
      issueNumber: issuesTable.issueNumber,
      title: issuesTable.title,
      statusId: issuesTable.statusId,
    })
    .from(issuesTable)
    .where(and(
      eq(issuesTable.parentIssueId, issueId),
      eq(issuesTable.isDeleted, 0),
    ))
    .orderBy(desc(issuesTable.createdAt))

  return c.json({
    success: true,
    data: { ...serializeIssue(issue), forks: forkRows },
  }, 200 as const)
})

export default query
