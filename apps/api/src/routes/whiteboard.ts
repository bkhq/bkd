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

// POST /ask — AI interaction via bound issue follow-up
whiteboardRoutes.openapi(R.whiteboardAsk, async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const body = c.req.valid('json')

    // Find the target node
    const [targetNode] = await db
      .select()
      .from(whiteboardNodes)
      .where(and(eq(whiteboardNodes.id, body.nodeId), eq(whiteboardNodes.projectId, project.id), notDeleted))
    if (!targetNode) {
      return c.json({ success: false, error: 'Node not found' }, 404 as const)
    }

    // Build node path (root → target) for context
    const allNodes = await db
      .select()
      .from(whiteboardNodes)
      .where(and(eq(whiteboardNodes.projectId, project.id), notDeleted))

    const nodeMap = new Map(allNodes.map(n => [n.id, n]))
    const path: string[] = []
    const visitedPath = new Set<string>()
    let current: typeof targetNode | undefined = targetNode
    while (current && !visitedPath.has(current.id)) {
      visitedPath.add(current.id)
      path.unshift(current.label || 'Untitled')
      current = current.parentId ? nodeMap.get(current.parentId) : undefined
    }

    // Build action-specific prompt
    const contextLines = [
      `Project: ${project.name}`,
      `Node path: ${path.join(' > ')}`,
      targetNode.content ? `Node content:\n${targetNode.content}` : '',
    ].filter(Boolean).join('\n')

    const actionPrompts: Record<string, string> = {
      explore: `${contextLines}\n\nGenerate 3-7 subtopics for this node. For each subtopic, output a markdown heading (##) followed by a brief description paragraph. Example:\n\n## Subtopic Title\nBrief description of the subtopic.`,
      explain: `${contextLines}\n\nExplain this topic in detail. Provide a clear, structured explanation.`,
      simplify: `${contextLines}\n\nSimplify and rewrite the content of this node to be more concise and easier to understand.`,
      examples: `${contextLines}\n\nProvide 3-5 concrete examples related to this topic. For each example, output a markdown heading (##) followed by a description.`,
      custom: `${contextLines}\n\n${body.prompt ?? ''}`,
    }
    const prompt = actionPrompts[body.action] ?? actionPrompts.custom

    // Find or create the bound whiteboard issue
    let boundIssueId = targetNode.boundIssueId
    // Walk up to root to find a bound issue (with cycle guard)
    if (!boundIssueId) {
      const visitedWalk = new Set<string>()
      let walk: typeof targetNode | undefined = targetNode
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
    const displayPrompt = `[Whiteboard] ${body.action}: ${targetNode.label || 'Untitled'}`

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
          prompt,
        })
        .returning()
      boundIssueId = newIssue.id

      // Execute the issue (first turn) — roll back issue on failure
      try {
        const result = await issueEngine.executeIssue(boundIssueId, {
          engineType: resolvedEngine,
          prompt: project.systemPrompt ? `${project.systemPrompt}\n\n${prompt}` : prompt,
          workingDir: effectiveWorkingDir,
          model: resolvedModel,
          envVars,
          displayPrompt,
        })

        // Bind to the root node after successful execution
        const rootNode = allNodes.find(n => !n.parentId)
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
      const rootNode = allNodes.find(n => !n.parentId)
      if (rootNode) {
        await db.update(whiteboardNodes)
          .set({ boundIssueId: null, updatedAt: new Date() })
          .where(eq(whiteboardNodes.id, rootNode.id))
      }
      return c.json({ success: false, error: 'Bound issue was deleted. Please try again.' }, 404 as const)
    }

    // If the bound issue has no session (e.g. session ID was reset on failure),
    // re-execute instead of following up on a broken session
    if (!boundIssue.externalSessionId) {
      const result = await issueEngine.executeIssue(boundIssueId, {
        engineType: resolvedEngine,
        prompt: project.systemPrompt ? `${project.systemPrompt}\n\n${prompt}` : prompt,
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

    // Follow-up on existing bound issue — do not override the issue's model
    const result = await issueEngine.followUpIssue(
      boundIssueId,
      prompt,
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

// POST /parse-response — parse latest assistant-message and create child nodes
whiteboardRoutes.openapi(R.parseWhiteboardResponse, async (c) => {
  try {
    const projectId = c.req.param('projectId')!
    const project = await findProject(projectId)
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as const)
    }

    const { nodeId, issueId } = c.req.valid('json')

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

    // Fetch the latest assistant-message for this issue
    const [latestLog] = await db
      .select({ content: issueLogs.content })
      .from(issueLogs)
      .where(and(
        eq(issueLogs.issueId, issueId),
        eq(issueLogs.entryType, 'assistant-message'),
      ))
      .orderBy(desc(issueLogs.createdAt))
      .limit(1)

    if (!latestLog) {
      return c.json({ success: false, error: 'No assistant message found for this issue' }, 404 as const)
    }

    // Parse markdown ## headings into sections
    const sections = parseMarkdownSections(latestLog.content)
    if (sections.length === 0) {
      return c.json({ success: true, data: [] }, 200 as const)
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

    return c.json({ success: true, data: created.map(deserializeRow) }, 200 as const)
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
