import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable, whiteboardNodes } from '@/db/schema'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const whiteboardRoutes = createOpenAPIRouter()

const notDeleted = eq(whiteboardNodes.isDeleted, 0)

function serializeMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  return metadata !== undefined ? JSON.stringify(metadata) : undefined
}

function deserializeRow(row: typeof whiteboardNodes.$inferSelect) {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }
}

// GET /nodes
whiteboardRoutes.openapi(R.listWhiteboardNodes, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const rows = await db
      .select()
      .from(whiteboardNodes)
      .where(and(eq(whiteboardNodes.projectId, project.id), notDeleted))
    return c.json({ success: true, data: rows.map(deserializeRow) }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_list_failed')
    return c.json({ success: false, error: 'Failed to list whiteboard nodes' }, 500 as const)
  }
})

// POST /nodes
whiteboardRoutes.openapi(R.createWhiteboardNode, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const { metadata, ...rest } = c.req.valid('json')
    const [row] = await db
      .insert(whiteboardNodes)
      .values({ ...rest, metadata: serializeMetadata(metadata), projectId: project.id })
      .returning()
    return c.json({ success: true, data: deserializeRow(row) }, 201 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_create_failed')
    return c.json({ success: false, error: 'Failed to create whiteboard node' }, 500 as const)
  }
})

// PATCH /nodes/:nodeId
whiteboardRoutes.openapi(R.updateWhiteboardNode, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const nodeId = c.req.param('nodeId')
    const { metadata, boundIssueId, ...rest } = c.req.valid('json')
    const setData: Record<string, unknown> = { ...rest, updatedAt: new Date() }
    if (metadata !== undefined) setData.metadata = serializeMetadata(metadata)
    if (boundIssueId !== undefined) {
      if (boundIssueId !== null) {
        const issue = await db
          .select({ id: issuesTable.id })
          .from(issuesTable)
          .where(and(eq(issuesTable.id, boundIssueId), eq(issuesTable.projectId, project.id)))
        if (issue.length === 0) {
          return c.json({ success: false, error: 'Bound issue not found in this project' }, 404 as const)
        }
      }
      setData.boundIssueId = boundIssueId
    }

    const [row] = await db
      .update(whiteboardNodes)
      .set(setData)
      .where(and(
        eq(whiteboardNodes.id, nodeId),
        eq(whiteboardNodes.projectId, project.id),
        notDeleted,
      ))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Node not found' }, 404 as const)
    }
    return c.json({ success: true, data: deserializeRow(row) }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_update_failed')
    return c.json({ success: false, error: 'Failed to update whiteboard node' }, 500 as const)
  }
})

// DELETE /nodes/:nodeId (soft delete node + descendants)
whiteboardRoutes.openapi(R.deleteWhiteboardNode, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const nodeId = c.req.param('nodeId')

    // Verify node exists
    const [target] = await db
      .select({ id: whiteboardNodes.id })
      .from(whiteboardNodes)
      .where(and(
        eq(whiteboardNodes.id, nodeId),
        eq(whiteboardNodes.projectId, project.id),
        notDeleted,
      ))
    if (!target) {
      return c.json({ success: false, error: 'Node not found' }, 404 as const)
    }

    // Collect all descendant IDs via iterative BFS (with cycle guard)
    const allNodes = await db
      .select({ id: whiteboardNodes.id, parentId: whiteboardNodes.parentId })
      .from(whiteboardNodes)
      .where(and(eq(whiteboardNodes.projectId, project.id), notDeleted))

    const childrenMap = new Map<string | null, string[]>()
    for (const n of allNodes) {
      const parent = n.parentId ?? null
      const list = childrenMap.get(parent)
      if (list) list.push(n.id)
      else childrenMap.set(parent, [n.id])
    }

    const idsToDelete: string[] = []
    const visited = new Set<string>()
    const queue = [nodeId]
    while (queue.length > 0) {
      const current = queue.pop()!
      if (visited.has(current)) continue
      visited.add(current)
      idsToDelete.push(current)
      const children = childrenMap.get(current)
      if (children) queue.push(...children)
    }

    // Soft delete all
    await db
      .update(whiteboardNodes)
      .set({ isDeleted: 1, updatedAt: new Date() })
      .where(inArray(whiteboardNodes.id, idsToDelete))

    return c.json({ success: true, data: { ids: idsToDelete } }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_delete_failed')
    return c.json({ success: false, error: 'Failed to delete whiteboard node' }, 500 as const)
  }
})

// PATCH /nodes/bulk
whiteboardRoutes.openapi(R.bulkUpdateWhiteboardNodes, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const { nodes } = c.req.valid('json')

    const results = await db.transaction(async (tx) => {
      const updated: (typeof whiteboardNodes.$inferSelect)[] = []
      for (const node of nodes) {
        const setData: Record<string, unknown> = { updatedAt: new Date() }
        if (node.parentId !== undefined) setData.parentId = node.parentId
        if (node.sortOrder !== undefined) setData.sortOrder = node.sortOrder

        const [row] = await tx
          .update(whiteboardNodes)
          .set(setData)
          .where(and(
            eq(whiteboardNodes.id, node.id),
            eq(whiteboardNodes.projectId, project.id),
            notDeleted,
          ))
          .returning()
        if (row) updated.push(row)
      }
      return updated
    })

    return c.json({ success: true, data: results.map(deserializeRow) }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_bulk_update_failed')
    return c.json({ success: false, error: 'Failed to bulk update whiteboard nodes' }, 500 as const)
  }
})

export default whiteboardRoutes
