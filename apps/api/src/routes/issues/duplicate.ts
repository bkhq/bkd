import { and, desc, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { cacheDelByPrefix } from '@/cache'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { getProjectOwnedIssue, serializeIssue } from './_shared'

const duplicate = new Hono()

// POST /api/projects/:projectId/issues/:id/duplicate — Duplicate an issue
duplicate.post('/:id/duplicate', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const source = await getProjectOwnedIssue(project.id, issueId)
  if (!source) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  const [newIssue] = await db.transaction(async (tx) => {
    // Compute next issueNumber
    const [maxNumRow] = await tx
      .select({ maxNum: max(issuesTable.issueNumber) })
      .from(issuesTable)
      .where(eq(issuesTable.projectId, project.id))
    const issueNumber = (maxNumRow?.maxNum ?? 0) + 1

    // Compute sortOrder: place after the last item in todo column
    const [lastItem] = await tx
      .select({ sortOrder: issuesTable.sortOrder })
      .from(issuesTable)
      .where(
        and(
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.statusId, 'todo'),
          eq(issuesTable.isDeleted, 0),
        ),
      )
      .orderBy(desc(issuesTable.sortOrder))
      .limit(1)
    const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

    return tx
      .insert(issuesTable)
      .values({
        projectId: project.id,
        statusId: 'todo',
        issueNumber,
        title: source.title,
        tag: source.tag,
        sortOrder,
        parentIssueId: source.parentIssueId ?? null,
        useWorktree: source.useWorktree,
        engineType: source.engineType,
        model: source.model,
        prompt: source.prompt,
      })
      .returning()
  })

  await cacheDelByPrefix(`childCounts:${project.id}`)

  return c.json({ success: true, data: serializeIssue(newIssue!) }, 201)
})

export default duplicate
