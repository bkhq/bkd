import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { and, desc, eq, inArray, max } from 'drizzle-orm'
import { generateKeyBetween } from 'jittered-fractional-indexing'
import { db } from '@/db'
import { findProject, getAppSetting, getDefaultEngine, getEngineDefaultModel } from '@/db/helpers'
import { issueLogs, issues as issuesTable, whiteboardNodes } from '@/db/schema'
import { issueEngine } from '@/engines/issue/engine'
import type { EngineType } from '@/engines/types'
import { parseProjectEnvVars } from '@/routes/issues/_shared'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { buildWhiteboardSystemPrompt, buildWhiteboardTurnPrompt } from './whiteboard-prompt'

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

// DELETE /nodes — Reset whiteboard (soft-delete all nodes)
whiteboardRoutes.delete('/nodes', async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404)
    }

    const result = await db
      .update(whiteboardNodes)
      .set({ isDeleted: 1, updatedAt: new Date() })
      .where(and(eq(whiteboardNodes.projectId, project.id), notDeleted))
      .returning({ id: whiteboardNodes.id })

    return c.json({ success: true, data: { count: result.length } })
  } catch (err) {
    logger.error({ err }, 'whiteboard_reset_failed')
    return c.json({ success: false, error: 'Failed to reset whiteboard' }, 500)
  }
})

// POST /ask — AI interaction via bound issue follow-up
whiteboardRoutes.openapi(R.whiteboardAsk, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const body = c.req.valid('json')

    // Snapshot the whole whiteboard tree for the AI
    const allNodes = await db
      .select()
      .from(whiteboardNodes)
      .where(and(eq(whiteboardNodes.projectId, project.id), notDeleted))

    const nodeMap = new Map(allNodes.map(n => [n.id, n]))

    // Optional active node — focal context for the user's intent
    let activeNode: typeof allNodes[number] | null = null
    if (body.nodeId) {
      const found = allNodes.find(n => n.id === body.nodeId) ?? null
      if (!found) {
        return c.json({ success: false, error: 'Node not found' }, 404 as const)
      }
      activeNode = found
    }

    // Turn prompt: tree snapshot + active-node focus + user intent.
    // System prompt is only prepended on the very first turn (below).
    const turnPrompt = buildWhiteboardTurnPrompt({
      rows: allNodes,
      activeNodeId: activeNode?.id,
      userPrompt: body.prompt,
    })

    // Find or create the bound whiteboard issue. The whiteboard binds a single
    // shared conversation to the root node so every ask continues the same session.
    const rootNode = allNodes.find(n => !n.parentId) ?? null
    let boundIssueId: string | null = rootNode?.boundIssueId ?? null

    // Legacy: tree may have bound issue anchored on a non-root node. Walk to find it.
    if (!boundIssueId && activeNode) {
      const visitedWalk = new Set<string>()
      let walk: typeof activeNode | undefined = activeNode
      while (walk && !boundIssueId) {
        if (visitedWalk.has(walk.id)) break
        visitedWalk.add(walk.id)
        boundIssueId = walk.boundIssueId
        walk = walk.parentId ? nodeMap.get(walk.parentId) : undefined
      }
    }

    const resolvedEngine = (body.engineType ?? await getDefaultEngine() ?? 'claude-code') as EngineType
    let resolvedModel = body.model
    if (!resolvedModel) {
      const savedModel = await getEngineDefaultModel(resolvedEngine)
      if (savedModel && savedModel !== 'auto') resolvedModel = savedModel
    }

    // SEC-016: Validate and resolve working directory
    let effectiveWorkingDir: string | undefined
    if (project.directory) {
      const resolvedDir = resolve(project.directory)
      const workspaceRoot = await getAppSetting('workspace:defaultPath')
      if (workspaceRoot && workspaceRoot !== '/') {
        const resolvedRoot = resolve(workspaceRoot)
        if (!resolvedDir.startsWith(`${resolvedRoot}/`) && resolvedDir !== resolvedRoot) {
          logger.warn({ projectId: project.id, resolvedDir, workspaceRoot: resolvedRoot }, 'whiteboard_workdir_outside_workspace')
          return c.json({ success: false, error: 'Project directory is outside the configured workspace' }, 500 as const)
        }
      }
      try {
        await mkdir(resolvedDir, { recursive: true })
        const s = await stat(resolvedDir)
        if (!s.isDirectory()) {
          return c.json({ success: false, error: 'Project directory is not a valid directory' }, 500 as const)
        }
        effectiveWorkingDir = resolvedDir
      } catch (dirErr) {
        logger.warn({ projectId: project.id, resolvedDir, err: dirErr }, 'whiteboard_workdir_prepare_failed')
        return c.json({ success: false, error: 'Failed to prepare project working directory' }, 500 as const)
      }
    }

    const envVars = parseProjectEnvVars(project.envVars)

    // Short, user-facing label for the log UI. We prefer the user's intent (truncated)
    // over a hard-coded action tag — the action enum is gone.
    const intentPreview = body.prompt.replace(/\s+/g, ' ').slice(0, 80)
    const displayPrompt = activeNode
      ? `[Whiteboard] ${activeNode.label || 'Untitled'}: ${intentPreview}`
      : `[Whiteboard] ${intentPreview}`

    // First turn prompt = whiteboard system prompt + project system prompt + turn prompt.
    // Follow-up turns only send the turn prompt (the AI already has the whiteboard
    // system instructions from the first turn's session state).
    const whiteboardSystem = buildWhiteboardSystemPrompt(project.id, project.name)
    const firstTurnPrompt = [
      whiteboardSystem,
      project.systemPrompt ?? '',
      turnPrompt,
    ].filter(Boolean).join('\n\n')

    if (!boundIssueId) {
      // Create a new whiteboard issue
      const [maxNumRow] = await db
        .select({ maxNum: max(issuesTable.issueNumber) })
        .from(issuesTable)
        .where(eq(issuesTable.projectId, project.id))
      const issueNumber = (maxNumRow?.maxNum ?? 0) + 1
      const [lastItem] = await db
        .select({ sortOrder: issuesTable.sortOrder })
        .from(issuesTable)
        .where(and(
          eq(issuesTable.projectId, project.id),
          eq(issuesTable.statusId, 'working'),
          eq(issuesTable.isDeleted, 0),
        ))
        .orderBy(desc(issuesTable.sortOrder))
        .limit(1)
      const sortOrder = generateKeyBetween(lastItem?.sortOrder ?? null, null)

      const [newIssue] = await db
        .insert(issuesTable)
        .values({
          projectId: project.id,
          statusId: 'working',
          issueNumber,
          title: `[Whiteboard] ${project.name}`,
          tag: JSON.stringify(['whiteboard']),
          sortOrder,
          engineType: resolvedEngine,
          model: resolvedModel ?? null,
          prompt: turnPrompt,
          // Hidden from regular issue listings — the whiteboard has its own
          // chat surface for this conversation.
          isHidden: true,
        })
        .returning()
      boundIssueId = newIssue.id

      // Execute the issue (first turn) — roll back issue on failure
      try {
        const result = await issueEngine.executeIssue(boundIssueId, {
          engineType: resolvedEngine,
          prompt: firstTurnPrompt,
          workingDir: effectiveWorkingDir,
          model: resolvedModel,
          envVars,
          displayPrompt,
        })

        // Bind to the root node after successful execution
        if (rootNode) {
          await db.update(whiteboardNodes)
            .set({ boundIssueId: newIssue.id, updatedAt: new Date() })
            .where(eq(whiteboardNodes.id, rootNode.id))
        }

        return c.json({
          success: true,
          data: { issueId: boundIssueId, executionId: result.executionId },
        }, 200 as const)
      } catch (execErr) {
        // Roll back orphan issue on first-turn failure
        logger.error({ err: execErr, issueId: boundIssueId }, 'whiteboard_first_execute_failed')
        await db.update(issuesTable)
          .set({ isDeleted: 1, updatedAt: new Date() })
          .where(eq(issuesTable.id, boundIssueId))
        return c.json({ success: false, error: 'Failed to start whiteboard AI session' }, 500 as const)
      }
    }

    // Validate bound issue still exists and has a usable session
    const [boundIssue] = await db
      .select({ id: issuesTable.id, sessionStatus: issuesTable.sessionStatus, externalSessionId: issuesTable.externalSessionId })
      .from(issuesTable)
      .where(and(eq(issuesTable.id, boundIssueId), eq(issuesTable.isDeleted, 0)))

    if (!boundIssue) {
      // Clear stale binding so next ask creates a fresh issue
      if (rootNode) {
        await db.update(whiteboardNodes)
          .set({ boundIssueId: null, updatedAt: new Date() })
          .where(eq(whiteboardNodes.id, rootNode.id))
      }
      return c.json({ success: false, error: 'Bound issue was deleted. Please try again.' }, 404 as const)
    }

    // If the bound issue has no session (e.g. session ID was reset on failure),
    // re-execute — treat this as a "first turn" and re-send the full system prompt.
    if (!boundIssue.externalSessionId) {
      const result = await issueEngine.executeIssue(boundIssueId, {
        engineType: resolvedEngine,
        prompt: firstTurnPrompt,
        workingDir: effectiveWorkingDir,
        model: resolvedModel,
        envVars,
        displayPrompt,
      })
      return c.json({
        success: true,
        data: { issueId: boundIssueId, executionId: result.executionId },
      }, 200 as const)
    }

    // Follow-up on existing bound issue — only turn prompt, system already in session.
    // Do not override the issue's model.
    const result = await issueEngine.followUpIssue(
      boundIssueId,
      turnPrompt,
      undefined,
      undefined,
      'queue',
      displayPrompt,
    )

    return c.json({
      success: true,
      data: { issueId: boundIssueId, executionId: result.executionId, queued: false },
    }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_ask_failed')
    return c.json({ success: false, error: 'Failed to process whiteboard AI request' }, 500 as const)
  }
})

// POST /parse-response — parse the latest assistant-message and create child
// nodes from `## headings`. The whiteboard AI returns structured markdown and
// this endpoint converts each top-level heading into a child node under the
// given parent. Callers should treat it as a best-effort extraction.
whiteboardRoutes.openapi(R.parseWhiteboardResponse, async (c) => {
  try {
    const projectId = c.req.param('projectId')!
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const { nodeId, issueId, skipInsert } = c.req.valid('json')

    // Verify parent node belongs to this project
    const [parentNode] = await db
      .select()
      .from(whiteboardNodes)
      .where(and(
        eq(whiteboardNodes.id, nodeId),
        eq(whiteboardNodes.projectId, project.id),
        notDeleted,
      ))
    if (!parentNode) {
      return c.json({ success: false, error: 'Node not found' }, 404 as const)
    }

    // Verify the issue belongs to this project
    const [issue] = await db
      .select({ id: issuesTable.id })
      .from(issuesTable)
      .where(and(
        eq(issuesTable.id, issueId),
        eq(issuesTable.projectId, project.id),
        eq(issuesTable.isDeleted, 0),
      ))
    if (!issue) {
      return c.json({ success: false, error: 'Issue not found' }, 404 as const)
    }

    // Fetch latest visible assistant-messages; filter out hidden meta entries
    // (metadata.type='system') in application layer since metadata is JSON text.
    const candidateLogs = await db
      .select({ content: issueLogs.content, metadata: issueLogs.metadata })
      .from(issueLogs)
      .where(and(
        eq(issueLogs.issueId, issueId),
        eq(issueLogs.entryType, 'assistant-message'),
        eq(issueLogs.visible, 1),
        eq(issueLogs.isDeleted, 0),
      ))
      .orderBy(desc(issueLogs.createdAt))
      .limit(10)

    const latestLog = candidateLogs.find((log) => {
      if (!log.metadata) return true
      try {
        return JSON.parse(log.metadata)?.type !== 'system'
      } catch {
        return true
      }
    })

    if (!latestLog) {
      return c.json({ success: false, error: 'No assistant message found for this issue' }, 404 as const)
    }

    // If skipInsert, return raw content only (for explain/simplify)
    if (skipInsert) {
      return c.json({ success: true, data: { nodes: [], rawContent: latestLog.content } }, 200 as const)
    }

    // Parse markdown ## headings into sections
    const sections = parseMarkdownSections(latestLog.content)
    if (sections.length === 0) {
      return c.json({ success: true, data: { nodes: [], rawContent: latestLog.content } }, 200 as const)
    }

    // Determine sort orders for new children (append after existing children)
    const existingChildren = await db
      .select({ sortOrder: whiteboardNodes.sortOrder })
      .from(whiteboardNodes)
      .where(and(
        eq(whiteboardNodes.parentId, nodeId),
        notDeleted,
      ))
      .orderBy(desc(whiteboardNodes.sortOrder))
      .limit(1)

    let lastSortOrder = existingChildren[0]?.sortOrder ?? null

    // Insert children in order
    const created: (typeof whiteboardNodes.$inferSelect)[] = []
    for (const section of sections) {
      const sortOrder = generateKeyBetween(lastSortOrder, null)
      lastSortOrder = sortOrder
      const [row] = await db
        .insert(whiteboardNodes)
        .values({
          projectId: project.id,
          parentId: nodeId,
          label: section.heading,
          content: section.body,
          sortOrder,
        })
        .returning()
      if (row) created.push(row)
    }

    return c.json({ success: true, data: { nodes: created.map(deserializeRow), rawContent: latestLog.content } }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_parse_response_failed')
    return c.json({ success: false, error: 'Failed to parse whiteboard response' }, 500 as const)
  }
})

// POST /generate-issues — recommend issues from selected nodes
whiteboardRoutes.openapi(R.generateIssuesFromNodes, async (c) => {
  try {
    const projectId = c.req.param('projectId')!
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const { nodeIds } = c.req.valid('json')

    // Fetch all project nodes to resolve descendants
    const allNodes = await db
      .select()
      .from(whiteboardNodes)
      .where(and(eq(whiteboardNodes.projectId, project.id), notDeleted))

    const nodeMap = new Map(allNodes.map(n => [n.id, n]))

    // Build children map
    const childrenMap = new Map<string, string[]>()
    for (const n of allNodes) {
      if (n.parentId) {
        const list = childrenMap.get(n.parentId)
        if (list) list.push(n.id)
        else childrenMap.set(n.parentId, [n.id])
      }
    }

    // For each requested nodeId, collect itself + all descendants
    const recommendations: Array<{ nodeId: string, title: string, prompt: string }> = []

    for (const nodeId of nodeIds) {
      const node = nodeMap.get(nodeId)
      if (!node) continue

      // Collect descendant labels for context
      const descendants: string[] = []
      const visited = new Set<string>()
      const queue = [...(childrenMap.get(nodeId) ?? [])]
      while (queue.length > 0) {
        const cid = queue.pop()!
        if (visited.has(cid)) continue
        visited.add(cid)
        const child = nodeMap.get(cid)
        if (child) {
          descendants.push(child.label || 'Untitled')
          queue.push(...(childrenMap.get(cid) ?? []))
        }
      }

      // Build ancestor path for context
      const path: string[] = []
      const visitedPath = new Set<string>()
      let current: typeof node | undefined = node
      while (current && !visitedPath.has(current.id)) {
        visitedPath.add(current.id)
        path.unshift(current.label || 'Untitled')
        current = current.parentId ? nodeMap.get(current.parentId) : undefined
      }

      const title = node.label || 'Untitled'
      const contextParts = [
        `Topic: ${path.join(' > ')}`,
        node.content ? `Context: ${node.content}` : '',
        descendants.length > 0 ? `Related subtopics: ${descendants.slice(0, 10).join(', ')}` : '',
      ].filter(Boolean)

      const prompt = [
        ...contextParts,
        '',
        `Implement: ${title}`,
      ].join('\n')

      recommendations.push({ nodeId, title, prompt })
    }

    return c.json({ success: true, data: recommendations }, 200 as const)
  } catch (err) {
    logger.error({ err }, 'whiteboard_generate_issues_failed')
    return c.json({ success: false, error: 'Failed to generate issues' }, 500 as const)
  }
})

/**
 * Parse markdown text with ## headings into heading+body sections.
 * Each `## Heading` line starts a new section; the body is the text
 * between this heading and the next.
 */
function parseMarkdownSections(text: string): Array<{ heading: string, body: string }> {
  const lines = text.split('\n')
  const sections: Array<{ heading: string, body: string }> = []
  let current: { heading: string, bodyLines: string[] } | null = null

  for (const line of lines) {
    const headingMatch = line.match(/^## (\S.*)$/)
    if (headingMatch) {
      if (current) {
        sections.push({ heading: current.heading, body: current.bodyLines.join('\n').trim() })
      }
      current = { heading: headingMatch[1].trim(), bodyLines: [] }
    } else if (current) {
      current.bodyLines.push(line)
    }
  }

  if (current) {
    sections.push({ heading: current.heading, body: current.bodyLines.join('\n').trim() })
  }

  return sections.filter(s => s.heading.length > 0)
}

export default whiteboardRoutes
