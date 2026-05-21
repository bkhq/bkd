import { and, desc, eq } from 'drizzle-orm'
import * as z from 'zod'
import { zValidator } from '@hono/zod-validator'
import { db } from '@/db'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { toISO } from '@/utils/date'
import { issueEngine } from '@/engines/issue/engine'
import { appEvents } from '@/events'
import { createOpenAPIRouter } from '@/openapi/hono'
import { logger } from '@/logger'
import {
  dryRunEnrichment,
  getSecretaryEngine,
  isSecretaryEnabled,
  SECRETARY_ENABLED_KEY,
  SECRETARY_ENGINE_KEY,
} from '@/cockpit/secretary'
import { ensureAssistantIssue, ensureCockpitProject } from './ensure-singleton'
import { buildCockpitSystemPrompt } from './prompt'

const ASSISTANT_ID_KEY = 'cockpit:assistantIssueId'

const COCKPIT_ENV: Record<string, string> = { BKD_COCKPIT_ASSISTANT: '1' }

const assistant = createOpenAPIRouter()

const askSchema = z.object({
  prompt: z.string().min(1).max(8000),
  model: z.string().regex(/^[\w./:\-[\]]{1,160}$/).optional(),
})

// GET /api/cockpit/assistant — return singleton issue id + project metadata.
assistant.get('/assistant', async (c) => {
  const project = await ensureCockpitProject()
  const { id: issueId } = await ensureAssistantIssue(project.id)
  return c.json({
    success: true,
    data: {
      issueId,
      projectId: project.id,
      projectAlias: project.alias,
      projectName: project.name,
    },
  })
})

// POST /api/cockpit/ask — first turn or follow-up against the assistant issue.
assistant.post('/ask', zValidator('json', askSchema), async (c) => {
  const body = c.req.valid('json')

  const project = await ensureCockpitProject()
  const { id: issueId, isFresh } = await ensureAssistantIssue(project.id)

  // Determine whether this is the first turn against this session.
  // isFresh means we just created the issue this request — definitely first turn.
  // Otherwise check sessionStatus + externalSessionId on the existing issue.
  // Also pick up the current engineType, which the user can change via
  // POST /api/cockpit/engine (defaults to claude-code-sdk).
  let firstTurn = isFresh
  let currentEngineType = 'claude-code-sdk'
  if (!firstTurn) {
    const [row] = await db
      .select({
        externalSessionId: issuesTable.externalSessionId,
        sessionStatus: issuesTable.sessionStatus,
        engineType: issuesTable.engineType,
      })
      .from(issuesTable)
      .where(and(eq(issuesTable.id, issueId), eq(issuesTable.isDeleted, 0)))
    if (!row || !row.externalSessionId) firstTurn = true
    if (row?.engineType) currentEngineType = row.engineType
  }

  const serverName = c.req.header('host') ?? 'bkd'

  try {
    if (firstTurn) {
      const systemPrompt = buildCockpitSystemPrompt(serverName)
      const fullPrompt = `${systemPrompt}\n\n## User request\n\n${body.prompt}`
      const result = await issueEngine.executeIssue(issueId, {
        engineType: currentEngineType as 'claude-code-sdk' | 'claude-code' | 'codex',
        prompt: fullPrompt,
        workingDir: undefined,
        model: body.model,
        envVars: COCKPIT_ENV,
        displayPrompt: body.prompt.slice(0, 200),
      })
      return c.json({
        success: true,
        data: { issueId, executionId: result.executionId, firstTurn: true },
      })
    }

    const result = await issueEngine.followUpIssue(
      issueId,
      body.prompt,
      body.model,
      undefined,
      'queue',
      body.prompt.slice(0, 200),
      undefined,
      undefined,
      undefined,
    )
    return c.json({
      success: true,
      data: { issueId, executionId: result.executionId, firstTurn: false },
    })
  } catch (err) {
    logger.error({ err, issueId }, 'cockpit_ask_failed')
    const message = err instanceof Error ? err.message : 'Failed to dispatch cockpit message'
    return c.json({ success: false, error: message }, 500)
  }
})

// POST /api/cockpit/engine — change the assistant's engine. Updates the
// singleton issue's engineType + clears its externalSessionId so the next
// /ask call is treated as a first turn (session can't survive an engine swap).
const engineSchema = z.object({
  engineType: z.string().min(1).max(80),
})

assistant.post('/engine', zValidator('json', engineSchema), async (c) => {
  const { engineType } = c.req.valid('json')
  const project = await ensureCockpitProject()
  const { id: issueId } = await ensureAssistantIssue(project.id)

  await db
    .update(issuesTable)
    .set({
      engineType,
      externalSessionId: null,
      sessionStatus: null,
      updatedAt: new Date(),
    })
    .where(eq(issuesTable.id, issueId))

  appEvents.emit('cockpit-reset', { issueId })

  return c.json({
    success: true,
    data: { issueId, engineType },
  })
})

// GET /api/cockpit/secretary-engine — the engine the background secretary
// runs enrichment on (separate from the chat assistant's engine above).
assistant.get('/secretary-engine', async (c) => {
  const engineType = await getSecretaryEngine()
  return c.json({ success: true, data: { engineType } })
})

// POST /api/cockpit/secretary-engine — change the secretary's enrichment
// engine. Stored as a plain setting; the next enrichment run picks it up.
assistant.post('/secretary-engine', zValidator('json', engineSchema), async (c) => {
  const { engineType } = c.req.valid('json')
  await setAppSetting(SECRETARY_ENGINE_KEY, engineType)
  return c.json({ success: true, data: { engineType } })
})

// GET /api/cockpit/secretary — combined secretary config (observability).
assistant.get('/secretary', async (c) => {
  const [engineType, enabled] = await Promise.all([
    getSecretaryEngine(),
    isSecretaryEnabled(),
  ])
  return c.json({ success: true, data: { engineType, enabled } })
})

// POST /api/cockpit/secretary-enabled — master switch for AI enrichment.
// Off → decision cards stay at the structured/template rung (no tokens spent).
const enabledSchema = z.object({ enabled: z.boolean() })

assistant.post('/secretary-enabled', zValidator('json', enabledSchema), async (c) => {
  const { enabled } = c.req.valid('json')
  await setAppSetting(SECRETARY_ENABLED_KEY, enabled ? 'true' : 'false')
  return c.json({ success: true, data: { enabled } })
})

// POST /api/cockpit/secretary/dry-run — run enrichment for one issue and
// return the prompt context + raw + parsed output, without touching the
// timeline. The test/observability hook: see exactly what the secretary
// produces for an issue on demand.
const dryRunSchema = z.object({ issueId: z.string().min(1).max(40) })

assistant.post('/secretary/dry-run', zValidator('json', dryRunSchema), async (c) => {
  const { issueId } = c.req.valid('json')
  const result = await dryRunEnrichment(issueId)
  return c.json({ success: true, data: result })
})

// GET /api/cockpit/recent-activity — recent non-hidden issues across all
// projects, ordered by statusUpdatedAt desc. Used by the cockpit
// ActivityStream to backfill on mount (SSE only delivers live updates).
assistant.get('/recent-activity', async (c) => {
  const raw = c.req.query('limit')
  const parsed = raw ? Number.parseInt(raw, 10) : 20
  const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 20, 1), 100)
  const rows = await db
    .select({
      issueId: issuesTable.id,
      title: issuesTable.title,
      projectAlias: projectsTable.alias,
      sessionStatus: issuesTable.sessionStatus,
      statusId: issuesTable.statusId,
      statusUpdatedAt: issuesTable.statusUpdatedAt,
    })
    .from(issuesTable)
    .innerJoin(projectsTable, eq(issuesTable.projectId, projectsTable.id))
    .where(and(
      eq(issuesTable.isDeleted, 0),
      eq(issuesTable.isHidden, false),
      eq(projectsTable.isDeleted, 0),
    ))
    .orderBy(desc(issuesTable.statusUpdatedAt))
    .limit(limit)
  return c.json({
    success: true,
    data: rows.map(r => ({
      ...r,
      statusUpdatedAt: toISO(r.statusUpdatedAt),
    })),
  })
})

// Workaround: prevent project list endpoints from forgetting about the cockpit
// project even when isArchived=1 — re-export the project record so the
// frontend can resolve aliases.
assistant.get('/project', async (c) => {
  const project = await ensureCockpitProject()
  return c.json({ success: true, data: project })
})

// POST /api/cockpit/reset — soft-delete the assistant issue + clear pointer.
assistant.post('/reset', async (c) => {
  const storedId = await getAppSetting(ASSISTANT_ID_KEY)
  if (!storedId) {
    return c.json({ success: true, data: { deletedIssueId: null } })
  }
  try {
    await db
      .update(issuesTable)
      .set({ isDeleted: 1, updatedAt: new Date() })
      .where(eq(issuesTable.id, storedId))
    await setAppSetting(ASSISTANT_ID_KEY, '')
    appEvents.emit('cockpit-reset', { issueId: storedId })
    return c.json({ success: true, data: { deletedIssueId: storedId } })
  } catch (err) {
    logger.error({ err, issueId: storedId }, 'cockpit_reset_failed')
    return c.json({ success: false, error: 'Failed to reset cockpit session' }, 500)
  }
})

// Light helper for tests / debugging.
assistant.get('/_singleton', async (c) => {
  const project = await ensureCockpitProject()
  const issue = await ensureAssistantIssue(project.id)
  // Look up project row from DB for confirmation
  const [row] = await db
    .select({ id: projectsTable.id, alias: projectsTable.alias, isArchived: projectsTable.isArchived })
    .from(projectsTable)
    .where(eq(projectsTable.id, project.id))
  return c.json({
    success: true,
    data: {
      project: row ?? project,
      issueId: issue.id,
      isFresh: issue.isFresh,
    },
  })
})

export default assistant
