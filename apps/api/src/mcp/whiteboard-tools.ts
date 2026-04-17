// @ts-nocheck -- @modelcontextprotocol/sdk subpath exports may not resolve under Bun monorepo hoisting
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import * as z from 'zod'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { whiteboardNodes } from '@/db/schema'
import { logger } from '@/logger'

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

const notDeleted = eq(whiteboardNodes.isDeleted, 0)

type WhiteboardRow = typeof whiteboardNodes.$inferSelect

function serializeNode(row: WhiteboardRow) {
  return {
    id: row.id,
    parentId: row.parentId ?? null,
    label: row.label,
    content: row.content,
    icon: row.icon ?? '',
    sortOrder: row.sortOrder,
    isCollapsed: row.isCollapsed,
  }
}

/** Fetch all non-deleted nodes for a project, ordered by parent+sortOrder. */
async function fetchProjectNodes(projectId: string): Promise<WhiteboardRow[]> {
  return db
    .select()
    .from(whiteboardNodes)
    .where(and(eq(whiteboardNodes.projectId, projectId), notDeleted))
    .orderBy(asc(whiteboardNodes.sortOrder))
}

/** Compute descendant set including the seed id. Uses iterative BFS with cycle guard. */
function collectDescendants(seedId: string, rows: WhiteboardRow[]): Set<string> {
  const childrenMap = new Map<string | null, string[]>()
  for (const n of rows) {
    const parent = n.parentId ?? null
    const list = childrenMap.get(parent)
    if (list) list.push(n.id)
    else childrenMap.set(parent, [n.id])
  }
  const visited = new Set<string>()
  const queue = [seedId]
  while (queue.length > 0) {
    const current = queue.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    const children = childrenMap.get(current)
    if (children) queue.push(...children)
  }
  return visited
}

export function registerWhiteboardMcpTools(server: McpServer): void {
  // ==================== whiteboard-get-tree ====================

  server.registerTool('whiteboard-get-tree', {
    title: 'Get Whiteboard Tree',
    description: [
      'Return the full mindmap tree for a project as a flat list of nodes.',
      'Each node includes id, parentId, label, content, icon, sortOrder, isCollapsed.',
      'The root node has parentId=null. Children are ordered by sortOrder ascending.',
      '',
      'Use this before any add/update/delete/move so you know the current structure and IDs.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
    }),
  }, async ({ projectId }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const rows = await fetchProjectNodes(project.id)
    return textResult({
      projectId: project.id,
      nodes: rows.map(serializeNode),
    })
  })

  // ==================== whiteboard-add-node ====================

  server.registerTool('whiteboard-add-node', {
    title: 'Add Whiteboard Node',
    description: [
      'Add a new child node under the given parent node.',
      '',
      'Rules:',
      '- parentId must reference an existing non-deleted node in the same project.',
      '- label is required and becomes the node heading.',
      '- content is optional free-text body (supports markdown, no `##` headings inside).',
      '- icon is a short emoji or symbol shown beside the label.',
      '- The new node is appended after existing siblings (deterministic fractional key).',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      parentId: z.string().describe('Parent node ID (use whiteboard-get-tree to find it)'),
      label: z.string().min(1).max(200).describe('Node label / heading'),
      content: z.string().max(10_000).optional().describe('Node body content'),
      icon: z.string().max(8).optional().describe('Short emoji/icon'),
    }),
  }, async ({ projectId, parentId, label, content, icon }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    // Verify parent belongs to this project
    const [parent] = await db
      .select({ id: whiteboardNodes.id })
      .from(whiteboardNodes)
      .where(and(
        eq(whiteboardNodes.id, parentId),
        eq(whiteboardNodes.projectId, project.id),
        notDeleted,
      ))
    if (!parent) return errorResult('Parent node not found')

    // Compute sortOrder as "append after last sibling"
    const [lastSibling] = await db
      .select({ sortOrder: whiteboardNodes.sortOrder })
      .from(whiteboardNodes)
      .where(and(
        eq(whiteboardNodes.parentId, parentId),
        notDeleted,
      ))
      .orderBy(desc(whiteboardNodes.sortOrder))
      .limit(1)

    const sortOrder = generateKeyBetween(lastSibling?.sortOrder ?? null, null)

    try {
      const [row] = await db
        .insert(whiteboardNodes)
        .values({
          projectId: project.id,
          parentId,
          label,
          content: content ?? '',
          icon: icon ?? '',
          sortOrder,
        })
        .returning()
      return textResult(serializeNode(row!))
    } catch (err) {
      logger.error({ err, projectId: project.id, parentId }, 'mcp_whiteboard_add_failed')
      return errorResult('Failed to add whiteboard node')
    }
  })

  // ==================== whiteboard-update-node ====================

  server.registerTool('whiteboard-update-node', {
    title: 'Update Whiteboard Node',
    description: [
      'Update an existing node\'s label, content, icon, or collapsed state.',
      'Only the fields you pass are changed — omit fields you do not want to touch.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      nodeId: z.string().describe('Node ID to update'),
      label: z.string().min(1).max(200).optional().describe('New label'),
      content: z.string().max(10_000).optional().describe('New body content'),
      icon: z.string().max(8).optional().describe('New emoji/icon'),
      isCollapsed: z.boolean().optional().describe('Collapse/expand this node'),
    }),
  }, async ({ projectId, nodeId, label, content, icon, isCollapsed }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (label !== undefined) updates.label = label
    if (content !== undefined) updates.content = content
    if (icon !== undefined) updates.icon = icon
    if (isCollapsed !== undefined) updates.isCollapsed = isCollapsed

    if (Object.keys(updates).length === 1) {
      return errorResult('No fields to update')
    }

    try {
      const [row] = await db
        .update(whiteboardNodes)
        .set(updates)
        .where(and(
          eq(whiteboardNodes.id, nodeId),
          eq(whiteboardNodes.projectId, project.id),
          notDeleted,
        ))
        .returning()
      if (!row) return errorResult('Node not found')
      return textResult(serializeNode(row))
    } catch (err) {
      logger.error({ err, projectId: project.id, nodeId }, 'mcp_whiteboard_update_failed')
      return errorResult('Failed to update whiteboard node')
    }
  })

  // ==================== whiteboard-delete-node ====================

  server.registerTool('whiteboard-delete-node', {
    title: 'Delete Whiteboard Node',
    description: [
      'Soft-delete a node and its entire subtree.',
      '',
      'Refuses to delete the root node (parentId=null). Soft deletion can be reversed',
      'via DB maintenance but not via MCP — make sure you have the right target.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      nodeId: z.string().describe('Node ID to delete (descendants deleted too)'),
    }),
  }, async ({ projectId, nodeId }) => {
    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    // Verify target exists and is not the root
    const [target] = await db
      .select({ id: whiteboardNodes.id, parentId: whiteboardNodes.parentId })
      .from(whiteboardNodes)
      .where(and(
        eq(whiteboardNodes.id, nodeId),
        eq(whiteboardNodes.projectId, project.id),
        notDeleted,
      ))
    if (!target) return errorResult('Node not found')
    if (!target.parentId) return errorResult('Cannot delete the root node')

    try {
      const rows = await fetchProjectNodes(project.id)
      const idsToDelete = [...collectDescendants(nodeId, rows)]

      await db
        .update(whiteboardNodes)
        .set({ isDeleted: 1, updatedAt: new Date() })
        .where(inArray(whiteboardNodes.id, idsToDelete))

      return textResult({ deleted: true, ids: idsToDelete })
    } catch (err) {
      logger.error({ err, projectId: project.id, nodeId }, 'mcp_whiteboard_delete_failed')
      return errorResult('Failed to delete whiteboard node')
    }
  })

  // ==================== whiteboard-move-node ====================

  server.registerTool('whiteboard-move-node', {
    title: 'Move Whiteboard Node',
    description: [
      'Re-parent a node under a different parent, optionally positioning it after a sibling.',
      '',
      'Rules:',
      '- Cannot move the root node (parentId=null stays).',
      '- newParentId cannot equal nodeId and cannot be a descendant of nodeId (cycle prevention).',
      '- If afterId is provided, it must be an existing child of newParentId; the moved node',
      '  is placed directly after it. Omit afterId to append at the end.',
    ].join('\n'),
    inputSchema: z.object({
      projectId: z.string().describe('Project ID or alias'),
      nodeId: z.string().describe('Node ID to move'),
      newParentId: z.string().describe('New parent node ID'),
      afterId: z.string().optional().describe('Optional sibling under newParentId to position after; omit to append'),
    }),
  }, async ({ projectId, nodeId, newParentId, afterId }) => {
    if (nodeId === newParentId) return errorResult('Cannot move a node under itself')
    if (afterId === nodeId) return errorResult('afterId cannot equal nodeId')

    const project = await findProject(projectId)
    if (!project) return errorResult('Project not found')

    const rows = await fetchProjectNodes(project.id)
    const target = rows.find(r => r.id === nodeId)
    if (!target) return errorResult('Node not found')
    if (!target.parentId) return errorResult('Cannot move the root node')

    const newParent = rows.find(r => r.id === newParentId)
    if (!newParent) return errorResult('New parent not found')

    // Cycle guard: newParentId must not be within the subtree of nodeId
    const subtree = collectDescendants(nodeId, rows)
    if (subtree.has(newParentId)) {
      return errorResult('Cannot move a node under one of its descendants')
    }

    // Compute the insertion sortOrder
    const siblings = rows
      .filter(r => r.parentId === newParentId && r.id !== nodeId)
      .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))

    let newSortOrder: string
    if (afterId) {
      const afterIdx = siblings.findIndex(s => s.id === afterId)
      if (afterIdx < 0) return errorResult('afterId is not a child of newParentId')
      const afterKey = siblings[afterIdx].sortOrder
      const nextKey = siblings[afterIdx + 1]?.sortOrder ?? null
      newSortOrder = generateKeyBetween(afterKey, nextKey)
    } else {
      const lastKey = siblings.at(-1)?.sortOrder ?? null
      newSortOrder = generateKeyBetween(lastKey, null)
    }

    try {
      const [row] = await db
        .update(whiteboardNodes)
        .set({
          parentId: newParentId,
          sortOrder: newSortOrder,
          updatedAt: new Date(),
        })
        .where(and(
          eq(whiteboardNodes.id, nodeId),
          eq(whiteboardNodes.projectId, project.id),
          notDeleted,
        ))
        .returning()
      if (!row) return errorResult('Node not found')
      return textResult(serializeNode(row))
    } catch (err) {
      logger.error({ err, projectId: project.id, nodeId, newParentId }, 'mcp_whiteboard_move_failed')
      return errorResult('Failed to move whiteboard node')
    }
  })
}
