import { runtimeConfig } from '@/runtime-config'
import { EnabledSchema, EnvironmentSchema, WriteFilterRuleSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import { createRoute } from '@hono/zod-openapi'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import * as z from 'zod'
import {
  deleteAppSetting,
  getAppSetting,
  getServerName,
  getServerUrl,
  setAppSetting,
  setServerName,
  setServerUrl,
} from '@/db/helpers'
import { DISABLE_ASK_USER_KEY, SKIP_PERMISSIONS_KEY } from '@/engines/executors/claude/executor'
import { DEFAULT_LOG_PAGE_SIZE, LOG_PAGE_SIZE_KEY } from '@/engines/issue/constants'
import { refreshGlobalEnvCache } from '@/engines/safe-env'
import { getCachedCategorizedCommands } from '@/engines/issue/queries'
import type { WriteFilterRule } from '@/engines/write-filter'
import { DEFAULT_FILTER_RULES, WRITE_FILTER_RULES_KEY } from '@/engines/write-filter'
import { WORKTREE_AUTO_CLEANUP_KEY } from '@/cron/actions/builtins/worktree-cleanup'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const general = createOpenAPIRouter()

const WORKSPACE_PATH_KEY = 'workspace:defaultPath'

// GET /api/settings/workspace-path
general.openapi(R.getWorkspacePath, async (c) => {
  const value = await getAppSetting(WORKSPACE_PATH_KEY)
  return c.json({ success: true as const, data: { path: value ?? homedir() } }, 200)
})

// PATCH /api/settings/workspace-path
general.openapi(R.setWorkspacePath, async (c) => {
  const { path } = c.req.valid('json')
  const resolved = resolve(path)

  // Validate the path exists and is a directory
  try {
    const s = await stat(resolved)
    if (!s.isDirectory()) {
      return c.json({ success: false as const, error: 'Path is not a directory' }, 400 as const)
    }
  } catch {
    return c.json({ success: false as const, error: 'Path does not exist' }, 400 as const)
  }

  await setAppSetting(WORKSPACE_PATH_KEY, resolved)
  return c.json({ success: true as const, data: { path: resolved } }, 200 as const)
})

// --- Write Filter Rules ---

// GET /api/settings/write-filter-rules
general.openapi(R.getWriteFilterRules, async (c) => {
  const raw = await getAppSetting(WRITE_FILTER_RULES_KEY)
  let rules: WriteFilterRule[]
  if (raw) {
    try {
      rules = JSON.parse(raw) as WriteFilterRule[]
    } catch {
      rules = []
    }
  } else {
    rules = DEFAULT_FILTER_RULES
  }
  return c.json({ success: true as const, data: rules }, 200)
})

// PUT /api/settings/write-filter-rules
general.openapi(R.setWriteFilterRules, async (c) => {
  const { rules } = c.req.valid('json')
  await setAppSetting(WRITE_FILTER_RULES_KEY, JSON.stringify(rules))
  return c.json({ success: true as const, data: rules }, 200)
})

// PATCH /api/settings/write-filter-rules/:id
general.openapi(createRoute({
  method: 'patch',
  path: '/write-filter-rules/{id}',
  tags: ['Settings'],
  operationId: 'patchSettingsGeneralWriteFilterRules',
  request: { params: z.object({ id: z.string().min(1) }), body: { required: true, content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } },
  responses: {
    200: successResponse(WriteFilterRuleSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const ruleId = c.req.param('id')
  const { enabled } = c.req.valid('json')

  const raw = await getAppSetting(WRITE_FILTER_RULES_KEY)
  let rules: WriteFilterRule[]
  if (raw) {
    try {
      rules = JSON.parse(raw) as WriteFilterRule[]
    } catch {
      rules = []
    }
  } else {
    rules = [...DEFAULT_FILTER_RULES]
  }

  const rule = rules.find(r => r.id === ruleId)
  if (!rule) {
    return c.json({ success: false as const, error: `Rule not found: ${ruleId}` }, 404)
  }

  const updatedRules = rules.map(r => (r.id === ruleId ? { ...r, enabled } : r))
  await setAppSetting(WRITE_FILTER_RULES_KEY, JSON.stringify(updatedRules))
  return c.json({
    success: true as const,
    data: { ...rule, enabled },
  }, 200)
})

// --- Worktree Auto-Cleanup ---

// GET /api/settings/worktree-auto-cleanup
general.openapi(createRoute({
  method: 'get',
  path: '/worktree-auto-cleanup',
  tags: ['Settings'],
  operationId: 'getSettingsGeneralWorktreeAutoCleanup',
  responses: {
    200: successResponse(EnabledSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const value = await getAppSetting(WORKTREE_AUTO_CLEANUP_KEY)
  return c.json({ success: true as const, data: { enabled: value === 'true' } }, 200)
})

// PATCH /api/settings/worktree-auto-cleanup
general.openapi(createRoute({
  method: 'patch',
  path: '/worktree-auto-cleanup',
  tags: ['Settings'],
  operationId: 'patchSettingsGeneralWorktreeAutoCleanup',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } },
  responses: {
    200: successResponse(EnabledSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const { enabled } = c.req.valid('json')
  await setAppSetting(WORKTREE_AUTO_CLEANUP_KEY, String(enabled))
  return c.json({ success: true as const, data: { enabled } }, 200)
})

// --- Log Page Size ---

// GET /api/settings/log-page-size
general.openapi(R.getLogPageSize, async (c) => {
  const value = await getAppSetting(LOG_PAGE_SIZE_KEY)
  return c.json({
    success: true as const,
    data: { size: value ? Number(value) : DEFAULT_LOG_PAGE_SIZE },
  }, 200)
})

// PATCH /api/settings/log-page-size
general.openapi(R.setLogPageSize, async (c) => {
  const { size } = c.req.valid('json')
  await setAppSetting(LOG_PAGE_SIZE_KEY, String(size))
  return c.json({ success: true as const, data: { size } }, 200)
})

// --- Max Concurrent Executions ---

const MAX_CONCURRENT_KEY = 'engine:maxConcurrentExecutions'
const DEFAULT_MAX_CONCURRENT = runtimeConfig.MAX_CONCURRENT_EXECUTIONS

// GET /api/settings/max-concurrent-executions
general.openapi(R.getMaxConcurrent, async (c) => {
  const value = await getAppSetting(MAX_CONCURRENT_KEY)
  return c.json({
    success: true as const,
    data: { value: value ? Number(value) : DEFAULT_MAX_CONCURRENT },
  }, 200)
})

// PATCH /api/settings/max-concurrent-executions
general.openapi(R.setMaxConcurrent, async (c) => {
  const { value } = c.req.valid('json')
  await setAppSetting(MAX_CONCURRENT_KEY, String(value))

  // Apply at runtime
  const { issueEngine } = await import('@/engines/issue')
  issueEngine.setMaxConcurrent(value)

  return c.json({ success: true as const, data: { value } }, 200)
})

// --- Server Info ---

// GET /api/settings/server-info
general.openapi(R.getServerInfo, async (c) => {
  const [name, url] = await Promise.all([getServerName(), getServerUrl()])
  return c.json({ success: true as const, data: { name, url } }, 200)
})

// PATCH /api/settings/server-info
general.openapi(R.setServerInfo, async (c) => {
  const { name, url } = c.req.valid('json')

  if (name !== undefined) {
    const trimmed = name.trim()
    if (trimmed) {
      await setServerName(trimmed)
    } else {
      await deleteAppSetting('server:name')
    }
  }

  if (url !== undefined) {
    const trimmed = url.trim()
    if (trimmed) {
      await setServerUrl(trimmed)
    } else {
      await deleteAppSetting('server:url')
    }
  }

  const [currentName, currentUrl] = await Promise.all([getServerName(), getServerUrl()])
  return c.json({
    success: true as const,
    data: { name: currentName, url: currentUrl },
  }, 200)
})

// --- Slash Commands (cached from engine init, per-engine) ---

// GET /api/settings/slash-commands?engine=claude-code
general.openapi(R.getGlobalSlashCommands, async (c) => {
  const validEngines = ['claude-code', 'codex']
  const rawEngine = c.req.query('engine')
  if (rawEngine && !validEngines.includes(rawEngine)) {
    return c.json({ success: false as const, error: `Invalid engine type: ${rawEngine}` }, 400 as const)
  }
  const engine = rawEngine as import('@/engines/types').EngineType | undefined
  let categorized = getCachedCategorizedCommands(engine)
  // If cache is cold (empty result), try refreshing from DB before responding
  if (
    categorized.commands.length === 0 &&
    categorized.agents.length === 0 &&
    categorized.plugins.length === 0
  ) {
    const { refreshSlashCommandsCache } = await import('@/engines/issue/queries')
    await refreshSlashCommandsCache()
    categorized = getCachedCategorizedCommands(engine)
  }
  return c.json({ success: true as const, data: categorized }, 200 as const)
})

// --- Dangerously Skip Permissions ---

// GET /api/settings/skip-permissions
general.openapi(createRoute({
  method: 'get',
  path: '/skip-permissions',
  tags: ['Settings'],
  operationId: 'getSettingsGeneralSkipPermissions',
  responses: {
    200: successResponse(EnabledSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const value = await getAppSetting(SKIP_PERMISSIONS_KEY)
  return c.json({ success: true as const, data: { enabled: value === 'true' } }, 200)
})

// PATCH /api/settings/skip-permissions
general.openapi(createRoute({
  method: 'patch',
  path: '/skip-permissions',
  tags: ['Settings'],
  operationId: 'patchSettingsGeneralSkipPermissions',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } },
  responses: {
    200: successResponse(EnabledSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const { enabled } = c.req.valid('json')
  await setAppSetting(SKIP_PERMISSIONS_KEY, String(enabled))
  return c.json({ success: true as const, data: { enabled } }, 200)
})

// --- Disable AskUserQuestion ---

// GET /api/settings/disable-ask-user
general.openapi(createRoute({
  method: 'get',
  path: '/disable-ask-user',
  tags: ['Settings'],
  operationId: 'getSettingsGeneralDisableAskUser',
  responses: {
    200: successResponse(EnabledSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const value = await getAppSetting(DISABLE_ASK_USER_KEY)
  return c.json({ success: true as const, data: { enabled: value !== 'false' } }, 200)
})

// PATCH /api/settings/disable-ask-user
general.openapi(createRoute({
  method: 'patch',
  path: '/disable-ask-user',
  tags: ['Settings'],
  operationId: 'patchSettingsGeneralDisableAskUser',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ enabled: z.boolean() }) } } } },
  responses: {
    200: successResponse(EnabledSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const { enabled } = c.req.valid('json')
  await setAppSetting(DISABLE_ASK_USER_KEY, String(enabled))
  return c.json({ success: true as const, data: { enabled } }, 200)
})

// --- Global Engine Environment Variables ---

export const GLOBAL_ENV_VARS_KEY = 'engine:globalEnvVars'

// GET /api/settings/global-env-vars
general.openapi(createRoute({
  method: 'get',
  path: '/global-env-vars',
  tags: ['Settings'],
  operationId: 'getSettingsGeneralGlobalEnvVars',
  responses: {
    200: successResponse(EnvironmentSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const raw = await getAppSetting(GLOBAL_ENV_VARS_KEY)
  let vars: Record<string, string> = {}
  if (raw) {
    try {
      vars = JSON.parse(raw) as Record<string, string>
    } catch { /* ignore */ }
  }
  return c.json({ success: true as const, data: vars }, 200)
})

// PUT /api/settings/global-env-vars
general.openapi(createRoute({
  method: 'put',
  path: '/global-env-vars',
  tags: ['Settings'],
  operationId: 'putSettingsGeneralGlobalEnvVars',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({
    vars: z.record(z.string(), z.string())
      .refine(
        obj => Object.keys(obj).length <= 50,
        { message: 'Maximum 50 environment variables allowed' },
      )
      .refine(
        obj => Object.entries(obj).every(
          ([k, v]) => !/[\r\n]/.test(k) && !/[\r\n]/.test(v),
        ),
        { message: 'Environment variable keys and values must not contain line breaks' },
      ),
  }) } } } },
  responses: {
    200: successResponse(EnvironmentSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const { vars } = c.req.valid('json')
  await setAppSetting(GLOBAL_ENV_VARS_KEY, JSON.stringify(vars))
  await refreshGlobalEnvCache()
  return c.json({ success: true as const, data: vars }, 200)
})

export default general
