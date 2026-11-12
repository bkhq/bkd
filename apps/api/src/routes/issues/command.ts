import { findProject } from '@/db/helpers'
import { updateIssueSession } from '@/engines/engine-store'
import { issueEngine } from '@/engines/issue'
import { logger } from '@/logger'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import {
  ensureWorking,
  getProjectOwnedIssue,
  normalizePrompt,
  startIssueExecution,
} from './_shared'

const command = createOpenAPIRouter()

// POST /api/projects/:projectId/issues/:issueId/execute — Execute engine on issue
command.openapi(R.executeIssue, async (c) => {
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

  const body = c.req.valid('json')
  const prompt = normalizePrompt(body.prompt)
  if (!prompt) {
    return c.json({ success: false, error: 'Prompt is required' }, 400 as const)
  }

  try {
    const outcome = await startIssueExecution(project, issue, { ...body, prompt })
    if (!outcome.ok) {
      return c.json({ success: false, error: outcome.error }, outcome.status)
    }
    return c.json({
      success: true,
      data: { executionId: outcome.executionId, issueId, messageId: outcome.messageId },
    }, 200 as const)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        issueId,
        model: body.model,
        permissionMode: body.permissionMode,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_followup_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Operation failed',
      },
      400 as const,
    )
  }
})

// POST /api/projects/:projectId/issues/:issueId/restart — Restart a failed issue session
command.openapi(R.restartIssue, async (c) => {
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

  try {
    return await issueEngine.trackStart(issueId, async () => {
      const guard = await ensureWorking(issue)
      if (!guard.ok) {
        return c.json({ success: false, error: guard.reason! }, 400 as const)
      }
      const result = await issueEngine.restartIssue(issueId)
      return c.json({
        success: true,
        data: { executionId: result.executionId, issueId },
      }, 200 as const)
    })
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        issueId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_restart_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Operation failed',
      },
      400 as const,
    )
  }
})

// POST /api/projects/:projectId/issues/:issueId/clear-session — Clear external
// session id so the next run starts fresh (used when the CLI session has grown
// so large that resume triggers "Prompt is too long").
command.openapi(R.clearIssueSession, async (c) => {
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

  if (issue.sessionStatus === 'running' || issue.sessionStatus === 'pending') {
    return c.json(
      {
        success: false,
        error: 'Cancel the active session before clearing its session id',
      },
      400 as const,
    )
  }

  try {
    await updateIssueSession(issueId, { externalSessionId: null })
    logger.info({ projectId: project.id, issueId }, 'issue_session_cleared')
    return c.json({ success: true, data: { issueId } }, 200 as const)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        issueId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_clear_session_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Operation failed',
      },
      400 as const,
    )
  }
})

// POST /api/projects/:projectId/issues/:issueId/cancel — Cancel
command.openapi(R.cancelIssue, async (c) => {
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

  try {
    const status = await issueEngine.cancelIssue(issueId)
    return c.json({ success: true, data: { issueId, status } }, 200 as const)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        issueId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_cancel_failed',
    )
    return c.json(
      {
        success: false,
        error: 'Operation failed',
      },
      400 as const,
    )
  }
})

// POST /api/projects/:projectId/issues/:issueId/terminate — Force terminate
command.openapi(R.terminateIssue, async (c) => {
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

  try {
    await issueEngine.terminateProcess(issueId)
    return c.json({ success: true, data: { issueId, status: 'terminated' } }, 200 as const)
  } catch (error) {
    logger.warn(
      {
        projectId: project.id,
        issueId,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'issue_terminate_failed',
    )
    return c.json({ success: false, error: 'Operation failed' }, 400 as const)
  }
})

// GET /api/projects/:projectId/issues/:issueId/slash-commands — Get available slash commands
command.openapi(R.getSlashCommands, async (c) => {
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

  const engineType = (issue.engineType as import('@/engines/types').EngineType) ?? undefined
  const categorized = issueEngine.getCategorizedCommands(issueId, engineType)
  return c.json({ success: true, data: categorized }, 200 as const)
})

export default command
