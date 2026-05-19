import { db } from '@/db'
import { notes } from '@/db/schema'
import { findProject } from '@/db/helpers'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { getProjectOwnedIssue } from './_shared'

const summarize = createOpenAPIRouter()

// POST /api/projects/:projectId/issues/:issueId/summarize
summarize.openapi(R.summarizeIssue, async (c) => {
  try {
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

    // 1. Fetch issue logs
    const logResult = issueEngine.getLogs(issueId, { limit: 1000 })
    const entries = logResult.entries

    if (entries.length === 0) {
      return c.json({ success: false, error: 'No logs found for this issue' }, 400 as const)
    }

    // 2. Build structured summary from logs (no external LLM — reuse existing engine flow)
    const summaryContent = buildSummaryFromLogs(entries, issue.title)

    // 3. Infer tags from content
    const tags = inferTagsFromContent(summaryContent, issue.title)

    // 4. Save as note
    const [note] = await db
      .insert(notes)
      .values({
        title: `Summary: ${issue.title}`,
        content: summaryContent,
        projectId: project.id,
        issueId: issue.id,
        source: 'ai-summary',
        tags: JSON.stringify(tags),
      })
      .returning()

    return c.json({
      success: true,
      data: {
        ...note,
        tags,
      },
    }, 201 as const)
  } catch (err) {
    logger.error({ err }, 'issue_summarize_failed')
    return c.json({ success: false, error: 'Failed to summarize issue' }, 500 as const)
  }
})

// ── Helpers ──────────────────────────────────────────────

function buildSummaryFromLogs(entries: Array<{
  entryType: string
  content: string
  metadata?: Record<string, unknown> | null
}>, issueTitle: string): string {
  const lines: string[] = []
  const toolUses: string[] = []
  const userMessages: string[] = []
  const assistantMessages: string[] = []
  const errors: string[] = []

  for (const entry of entries) {
    const content = entry.content.slice(0, 500)
    switch (entry.entryType) {
      case 'user-message':
        userMessages.push(content)
        break
      case 'assistant-message':
        assistantMessages.push(content)
        break
      case 'tool-use': {
        const toolName = typeof entry.metadata?.toolName === 'string'
          ? entry.metadata.toolName
          : undefined
        toolUses.push(toolName || content.slice(0, 100))
        break
      }
      case 'error-message':
        errors.push(content)
        break
    }
  }

  lines.push(`## Issue Summary: ${issueTitle}`)
  lines.push('')
  lines.push(`- **Total interactions**: ${userMessages.length} user / ${assistantMessages.length} AI / ${toolUses.length} tool`)
  if (errors.length > 0) {
    lines.push(`- **Errors encountered**: ${errors.length}`)
  }
  lines.push('')

  if (userMessages.length > 0) {
    lines.push('### User Requests')
    userMessages.slice(-3).forEach((msg, i) => {
      lines.push(`${i + 1}. ${msg.slice(0, 200)}${msg.length > 200 ? '...' : ''}`)
    })
    lines.push('')
  }

  if (toolUses.length > 0) {
    const uniqueTools = [...new Set(toolUses)].slice(0, 10)
    lines.push('### Tools Used')
    uniqueTools.forEach(tool => lines.push(`- ${tool}`))
    lines.push('')
  }

  if (assistantMessages.length > 0) {
    const lastResponse = assistantMessages.at(-1)
    lines.push('### Final Response')
    lines.push(lastResponse.slice(0, 400) + (lastResponse.length > 400 ? '...' : ''))
    lines.push('')
  }

  if (errors.length > 0) {
    lines.push('### Errors')
    errors.slice(-2).forEach(err => lines.push(`- ${err.slice(0, 200)}`))
    lines.push('')
  }

  lines.push('---')
  lines.push('*This summary was auto-generated from session logs. Edit to add insights.*')

  return lines.join('\n')
}

function inferTagsFromContent(content: string, title: string): string[] {
  const tags = new Set<string>()
  const combined = (`${content} ${title}`).toLowerCase()

  const KEYWORD_TAGS: Record<string, string[]> = {
    登录: ['topic:auth'],
    auth: ['topic:auth'],
    jwt: ['topic:auth', 'tech:jwt'],
    token: ['topic:auth'],
    数据库: ['topic:db'],
    db: ['topic:db'],
    drizzle: ['topic:db', 'tech:drizzle'],
    schema: ['topic:db'],
    迁移: ['topic:db', 'topic:migration'],
    migration: ['topic:db', 'topic:migration'],
    react: ['tech:react'],
    query: ['tech:react-query'],
    api: ['topic:api'],
    路由: ['topic:api'],
    route: ['topic:api'],
    测试: ['topic:testing'],
    test: ['topic:testing'],
    部署: ['topic:deploy'],
    deploy: ['topic:deploy'],
    docker: ['topic:deploy', 'tech:docker'],
    缓存: ['topic:cache'],
    cache: ['topic:cache'],
    配置: ['topic:config'],
    config: ['topic:config'],
    类型: ['topic:types'],
    type: ['topic:types'],
  }

  for (const [keyword, tagList] of Object.entries(KEYWORD_TAGS)) {
    if (combined.includes(keyword.toLowerCase())) {
      tagList.forEach(t => tags.add(t))
    }
  }

  return Array.from(tags)
}

export default summarize
