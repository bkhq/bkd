import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { whiteboardNodes } from '@/db/schema'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const whiteboardRoutes = createOpenAPIRouter()

const notDeleted = eq(whiteboardNodes.isDeleted, 0)

// GET /nodes
whiteboardRoutes.openapi(R.listWhiteboardNodes, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const rows = await db
      .select()
      .from(whiteboardNodes)
      .where(and(eq(whiteboardNodes.projectId, projectId), notDeleted))
    return c.json({ success: true, data: rows }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_list_failed')
    return c.json({ success: false, error: 'Failed to list whiteboard nodes' }, 500 as const)
  }
})

// POST /nodes
whiteboardRoutes.openapi(R.createWhiteboardNode, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const body = c.req.valid('json')
    const [row] = await db
      .insert(whiteboardNodes)
      .values({ ...body, projectId })
      .returning()
    return c.json({ success: true, data: row }, 201 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_create_failed')
    return c.json({ success: false, error: 'Failed to create whiteboard node' }, 500 as const)
  }
})

// PATCH /nodes/:nodeId
whiteboardRoutes.openapi(R.updateWhiteboardNode, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const nodeId = c.req.param('nodeId')
    const data = c.req.valid('json')
    const [row] = await db
      .update(whiteboardNodes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(
        eq(whiteboardNodes.id, nodeId),
        eq(whiteboardNodes.projectId, projectId),
        notDeleted,
      ))
      .returning()
    if (!row) {
      return c.json({ success: false, error: 'Node not found' }, 404 as const)
    }
    return c.json({ success: true, data: row }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_update_failed')
    return c.json({ success: false, error: 'Failed to update whiteboard node' }, 500 as const)
  }
})

// DELETE /nodes/:nodeId (soft delete node + descendants)
whiteboardRoutes.openapi(R.deleteWhiteboardNode, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const nodeId = c.req.param('nodeId')

    // Verify node exists
    const [target] = await db
      .select({ id: whiteboardNodes.id })
      .from(whiteboardNodes)
      .where(and(
        eq(whiteboardNodes.id, nodeId),
        eq(whiteboardNodes.projectId, projectId),
        notDeleted,
      ))
    if (!target) {
      return c.json({ success: false, error: 'Node not found' }, 404 as const)
    }

    // Collect all descendant IDs via iterative BFS
    const allNodes = await db
      .select({ id: whiteboardNodes.id, parentId: whiteboardNodes.parentId })
      .from(whiteboardNodes)
      .where(and(eq(whiteboardNodes.projectId, projectId), notDeleted))

    const childrenMap = new Map<string | null, string[]>()
    for (const n of allNodes) {
      const parent = n.parentId ?? null
      const list = childrenMap.get(parent)
      if (list) list.push(n.id)
      else childrenMap.set(parent, [n.id])
    }

    const idsToDelete: string[] = []
    const queue = [nodeId]
    while (queue.length > 0) {
      const current = queue.pop()!
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
            eq(whiteboardNodes.projectId, projectId),
            notDeleted,
          ))
          .returning()
        if (row) updated.push(row)
      }
      return updated
    })

    return c.json({ success: true, data: results }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_bulk_update_failed')
    return c.json({ success: false, error: 'Failed to bulk update whiteboard nodes' }, 500 as const)
  }
})

export default whiteboardRoutes
