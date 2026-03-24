/**
 * OpenAPI spec registry.
 *
 * Registers all createRoute definitions into a shadow OpenAPIHono app
 * purely for spec generation. The actual request handling stays in
 * the existing route files with regular Hono + zValidator.
 *
 * This avoids a massive refactor of every route file while still
 * auto-generating the OpenAPI spec from Zod schemas.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { VERSION } from '@/version'
import * as routes from './routes'

/** Stub handler that returns 501 — these routes are never actually hit */
const stub = (c: any) => c.json({ success: false, error: 'stub' }, 501)

function buildRegistry() {
  // ── Meta (mounted at /api) ───────────────────────
  const api = new OpenAPIHono()
  api.openapi(routes.getApiRoot, stub)
  api.openapi(routes.getHealth, stub)
  api.openapi(routes.getStatus, stub)

  // ── Projects (mounted at /api) ───────────────────
  api.openapi(routes.listProjects, stub)
  api.openapi(routes.createProject, stub)
  api.openapi(routes.sortProject, stub)
  api.openapi(routes.getProject, stub)
  api.openapi(routes.updateProject, stub)
  api.openapi(routes.deleteProject, stub)
  api.openapi(routes.archiveProject, stub)
  api.openapi(routes.unarchiveProject, stub)

  // ── Issues (mounted at /api/projects/:projectId/issues) ──
  const issues = new OpenAPIHono()
  issues.openapi(routes.listIssues, stub)
  issues.openapi(routes.createIssue, stub)
  issues.openapi(routes.bulkUpdateIssues, stub)
  issues.openapi(routes.getIssue, stub)
  issues.openapi(routes.updateIssue, stub)
  issues.openapi(routes.deleteIssue, stub)
  issues.openapi(routes.duplicateIssue, stub)
  issues.openapi(routes.executeIssue, stub)
  issues.openapi(routes.followUpIssue, stub)
  issues.openapi(routes.restartIssue, stub)
  issues.openapi(routes.cancelIssue, stub)
  issues.openapi(routes.getSlashCommands, stub)
  issues.openapi(routes.getIssueLogs, stub)
  issues.openapi(routes.getIssueChanges, stub)
  api.route('/projects/{projectId}/issues', issues)

  // ── Engines (mounted at /api/engines) ────────────
  const engines = new OpenAPIHono()
  engines.openapi(routes.getAvailableEngines, stub)
  engines.openapi(routes.getEngineProfiles, stub)
  engines.openapi(routes.getEngineSettings, stub)
  engines.openapi(routes.setDefaultEngine, stub)
  engines.openapi(routes.setEngineModel, stub)
  engines.openapi(routes.setHiddenModels, stub)
  engines.openapi(routes.getEngineModels, stub)
  engines.openapi(routes.probeEngines, stub)
  api.route('/engines', engines)

  // ── Cron (mounted at /api/cron) ──────────────────
  const cron = new OpenAPIHono()
  cron.openapi(routes.listCronActions, stub)
  cron.openapi(routes.listCronJobs, stub)
  cron.openapi(routes.createCronJob, stub)
  cron.openapi(routes.deleteCronJob, stub)
  cron.openapi(routes.getCronJobLogs, stub)
  cron.openapi(routes.triggerCronJob, stub)
  cron.openapi(routes.pauseCronJob, stub)
  cron.openapi(routes.resumeCronJob, stub)
  api.route('/cron', cron)

  // ── Events (mounted at /api/events) ──────────────
  const events = new OpenAPIHono()
  events.openapi(routes.getEventStream, stub)
  api.route('/events', events)

  // ── Processes (mounted at /api/processes) ────────
  const processes = new OpenAPIHono()
  processes.openapi(routes.listProcesses, stub)
  processes.openapi(routes.terminateProcess, stub)
  api.route('/processes', processes)

  // ── Notes (mounted at /api/notes) ────────────────
  const notes = new OpenAPIHono()
  notes.openapi(routes.listNotes, stub)
  notes.openapi(routes.createNote, stub)
  notes.openapi(routes.updateNote, stub)
  notes.openapi(routes.deleteNote, stub)
  api.route('/notes', notes)

  // ── Settings (mounted at /api/settings) ──────────
  const settings = new OpenAPIHono()
  settings.openapi(routes.getWorkspacePath, stub)
  settings.openapi(routes.setWorkspacePath, stub)
  settings.openapi(routes.getServerInfo, stub)
  settings.openapi(routes.setServerInfo, stub)
  settings.openapi(routes.getLogPageSize, stub)
  settings.openapi(routes.setLogPageSize, stub)
  settings.openapi(routes.getMaxConcurrent, stub)
  settings.openapi(routes.setMaxConcurrent, stub)
  settings.openapi(routes.getWriteFilterRules, stub)
  settings.openapi(routes.setWriteFilterRules, stub)
  settings.openapi(routes.getGlobalSlashCommands, stub)
  // Webhooks
  settings.openapi(routes.listWebhooks, stub)
  settings.openapi(routes.createWebhook, stub)
  settings.openapi(routes.updateWebhook, stub)
  settings.openapi(routes.deleteWebhook, stub)
  settings.openapi(routes.getWebhookDeliveries, stub)
  settings.openapi(routes.testWebhook, stub)
  api.route('/settings', settings)

  // ── Worktrees (mounted at /api/projects/:projectId/worktrees) ──
  const worktrees = new OpenAPIHono()
  worktrees.openapi(routes.listWorktrees, stub)
  worktrees.openapi(routes.deleteWorktree, stub)
  api.route('/projects/{projectId}/worktrees', worktrees)

  return api
}

let cachedSpec: ReturnType<OpenAPIHono['getOpenAPI31Document']> | null = null

/** Get the generated OpenAPI 3.1 spec (cached after first call) */
export function getOpenAPISpec() {
  if (!cachedSpec) {
    const registry = buildRegistry()
    cachedSpec = registry.getOpenAPI31Document({
      openapi: '3.1.0',
      info: {
        title: 'BKD API',
        description: 'Kanban board for managing AI coding agents. Issues are assigned to CLI-based AI engines (Claude Code, Codex, Gemini CLI) that execute autonomously.',
        version: VERSION,
        license: { name: 'MIT' },
      },
      servers: [{ url: '/api', description: 'API base' }],
      tags: [
        { name: 'Meta', description: 'Health, status, and runtime information' },
        { name: 'Projects', description: 'Project CRUD and lifecycle' },
        { name: 'Issues', description: 'Issue CRUD, bulk updates, and duplication' },
        { name: 'Issue Commands', description: 'Execute, follow-up, restart, cancel AI sessions' },
        { name: 'Issue Logs', description: 'Retrieve and filter issue conversation logs' },
        { name: 'Engines', description: 'AI engine discovery, settings, and models' },
        { name: 'Cron', description: 'Scheduled job management' },
        { name: 'Events', description: 'Server-Sent Events for real-time updates' },
        { name: 'Processes', description: 'Active engine process management' },
        { name: 'Worktrees', description: 'Git worktree management per project' },
        { name: 'Notes', description: 'Scratch notes' },
        { name: 'Settings', description: 'Application settings and configuration' },
        { name: 'Webhooks', description: 'Webhook notification management' },
      ],
    })
  }
  return cachedSpec
}
