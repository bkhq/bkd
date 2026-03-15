import { and, asc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issueLogs as logsTable, issuesLogsToolsCall as toolsTable } from '@/db/schema'
import { isVisible } from '@/engines/issue/utils/visibility'
import type { NormalizedLogEntry } from '@/engines/types'
import { rawToToolAction } from '@/engines/issue/persistence/tool-detail'
import { getProjectOwnedIssue } from './_shared'

const exportRoute = new Hono()

function getAllLogs(issueId: string): NormalizedLogEntry[] {
  const rows = db
    .select()
    .from(logsTable)
    .where(and(eq(logsTable.issueId, issueId), eq(logsTable.visible, 1)))
    .orderBy(asc(logsTable.id))
    .all()

  const toolByLogId = new Map<string, (typeof toolsTable)['$inferSelect']>()
  if (rows.length > 0) {
    const logIds = rows.map(r => r.id)
    // Batch in chunks of 500 to avoid SQLite variable limits
    for (let i = 0; i < logIds.length; i += 500) {
      const chunk = logIds.slice(i, i + 500)
      const toolRows = db.select().from(toolsTable).where(inArray(toolsTable.logId, chunk)).all()
      for (const r of toolRows) toolByLogId.set(r.logId, r)
    }
  }

  return rows
    .map((row) => {
      const parsedMeta = row.metadata ? JSON.parse(row.metadata) : undefined
      const base: NormalizedLogEntry = {
        messageId: row.id,
        replyToMessageId: row.replyToMessageId ?? undefined,
        entryType: row.entryType as NormalizedLogEntry['entryType'],
        content: row.content.trim(),
        turnIndex: row.turnIndex,
        timestamp: row.timestamp ?? undefined,
        metadata: parsedMeta,
      }

      const tool = toolByLogId.get(row.id)
      if (tool) {
        const rawData = tool.raw ? JSON.parse(tool.raw) : {}
        base.toolDetail = {
          kind: tool.kind,
          toolName: tool.toolName,
          toolCallId: tool.toolCallId ?? undefined,
          isResult: tool.isResult ?? false,
          raw: rawData,
        }
        base.toolAction = rawToToolAction(tool.kind, rawData)
        if (!base.content && rawData.content) {
          base.content = rawData.content as string
        }
        if (!base.metadata && rawData.metadata) {
          base.metadata = rawData.metadata as Record<string, unknown>
        }
      }

      return base
    })
    .filter(isVisible)
}

function logsToText(logs: NormalizedLogEntry[], issueTitle: string): string {
  const lines: string[] = [`# ${issueTitle}`, '']

  for (const log of logs) {
    if (log.entryType === 'user-message') {
      lines.push(`## User`)
      lines.push('')
      lines.push(log.content)
      lines.push('')
    } else if (log.entryType === 'assistant-message') {
      lines.push(`## Assistant`)
      lines.push('')
      lines.push(log.content)
      lines.push('')
    } else if (log.entryType === 'tool-use' && log.toolAction) {
      const action = log.toolAction
      if (action.kind === 'command-run') {
        lines.push(`> Command: ${action.command}`)
        if (action.result) lines.push(`> Result: ${action.result}`)
        lines.push('')
      } else if (action.kind === 'file-read') {
        lines.push(`> Read: ${action.path}`)
        lines.push('')
      } else if (action.kind === 'file-edit') {
        lines.push(`> Edit: ${action.path}`)
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

// GET /api/projects/:projectId/issues/:id/export — Export issue logs
exportRoute.get('/:id/export', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404)
  }

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) {
    return c.json({ success: false, error: 'Issue not found' }, 404)
  }

  const format = c.req.query('format') || 'json'
  const logs = getAllLogs(issueId)
  const filename = `issue-${issue.issueNumber}-${issue.id}`

  if (format === 'txt') {
    const text = logsToText(logs, issue.title)
    return new Response(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.txt"`,
      },
    })
  }

  // Default: JSON
  const json = JSON.stringify({ issue: { id: issue.id, title: issue.title, issueNumber: issue.issueNumber }, logs }, null, 2)
  return new Response(json, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.json"`,
    },
  })
})

export default exportRoute
