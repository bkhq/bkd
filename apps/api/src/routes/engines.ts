import { VirtualEngineSchema, VirtualEnginesSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import { createRoute } from '@hono/zod-openapi'
import type { VirtualEngine } from '@bkd/shared'
import * as z from 'zod'
import {
  getAllEngineDefaultModels,
  getAllEngineHiddenModels,
  getDefaultEngine,
  setDefaultEngine,
  setEngineDefaultModel,
  setEngineHiddenModels,
} from '@/db/helpers'
import { engineRegistry } from '@/engines/executors'
import { getClaudeUsage } from '@/engines/executors/claude/usage'
import { getCodexUsage } from '@/engines/executors/codex/usage'
import type { EngineType } from '@/engines/types'
import { forceProbeEngines, getEngineDiscovery, getEngineModels } from '@/engines/startup-probe'
import { BUILT_IN_PROFILES } from '@/engines/types'
import {
  clearVirtualModelCache,
  decorateDiscoveryWithVirtual,
  fetchVirtualEngineModels,
  getVirtualEngine,
  getVirtualEngineProfiles,
  getVirtualEngines,
  isKnownEngineId,
  setVirtualEngines,
} from '@/engines/virtual-engines'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const engines = createOpenAPIRouter()

// GET /api/engines/available — List detected engines + models (cache → DB → live probe)
// Virtual engines are appended on top of the base discovery (not cached with it).
engines.openapi(R.getAvailableEngines, async (c) => {
  const base = await getEngineDiscovery()
  const { engines, models } = await decorateDiscoveryWithVirtual(base)
  return c.json({ success: true as const, data: { engines, models } }, 200)
})

// GET /api/engines/profiles — List engine profiles (built-in + virtual)
engines.openapi(R.getEngineProfiles, async (c) => {
  const profiles = [...Object.values(BUILT_IN_PROFILES), ...(await getVirtualEngineProfiles())]
  return c.json({ success: true as const, data: profiles }, 200)
})

// GET /api/engines/claude/usage — Claude subscription rate-limit utilization (TUI /usage panel)
engines.openapi(R.getClaudeUsage, async (c) => {
  const usage = await getClaudeUsage()
  return c.json({ success: true as const, data: usage }, 200)
})

// GET /api/engines/codex/usage — Codex subscription rate-limit utilization (TUI /status panel)
engines.openapi(R.getCodexUsage, async (c) => {
  const usage = await getCodexUsage()
  return c.json({ success: true as const, data: usage }, 200)
})

// --- Virtual engines (claude-code executor + preset env vars) ---

// GET /api/engines/virtual — List configured virtual engines
engines.openapi(createRoute({
  method: 'get',
  path: '/virtual',
  tags: ['Engines'],
  operationId: 'getEnginesVirtual',
  responses: {
    200: successResponse(VirtualEnginesSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const list = await getVirtualEngines()
  return c.json({ success: true as const, data: list }, 200)
})

// PUT /api/engines/virtual — Replace the full virtual engine list
engines.openapi(createRoute({
  method: 'put',
  path: '/virtual',
  tags: ['Engines'],
  operationId: 'putEnginesVirtual',
  request: { body: { required: true, content: { 'application/json': { schema: z.object({ engines: z.array(VirtualEngineSchema).max(50) }) } } } },
  responses: {
    200: successResponse(VirtualEnginesSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const { engines: list } = c.req.valid('json')
  try {
    const saved = await setVirtualEngines(list as VirtualEngine[])
    return c.json({ success: true as const, data: saved }, 200)
  } catch (error) {
    return c.json(
      { success: false as const, error: error instanceof Error ? error.message : 'Invalid virtual engines' },
      400,
    )
  }
})

// GET /api/engines/settings — Get all engine settings (default engine + per-engine models + hidden)
engines.openapi(R.getEngineSettings, async (c) => {
  const [defaults, hiddenModels, defaultEngine] = await Promise.all([
    getAllEngineDefaultModels(),
    getAllEngineHiddenModels(),
    getDefaultEngine(),
  ])
  const engines: Record<string, { defaultModel?: string, hiddenModels?: string[] }> = {}
  for (const [engineType, model] of Object.entries(defaults)) {
    engines[engineType] = { ...engines[engineType], defaultModel: model }
  }
  for (const [engineType, hidden] of Object.entries(hiddenModels)) {
    engines[engineType] = { ...engines[engineType], hiddenModels: hidden }
  }
  return c.json({ success: true as const, data: { defaultEngine, engines } }, 200)
})

// PATCH /api/engines/default-engine — Update global default engine
// Accepts a real engine type or a configured virtual engine id.
engines.openapi(R.setDefaultEngine, async (c) => {
  const { defaultEngine } = c.req.valid('json')
  if (!(await isKnownEngineId(defaultEngine))) {
    return c.json({ success: false as const, error: 'Invalid engine type' }, 400 as const)
  }
  await setDefaultEngine(defaultEngine)
  return c.json({ success: true as const, data: { defaultEngine } }, 200 as const)
})

// PATCH /api/engines/:engineType/settings — Upsert default model for an engine type
engines.openapi(R.setEngineModel, async (c) => {
  const engineType = c.req.param('engineType')
  if (!(await isKnownEngineId(engineType))) {
    return c.json({ success: false as const, error: `Unknown engine type: ${engineType}` }, 400 as const)
  }
  const { defaultModel } = c.req.valid('json')
  await setEngineDefaultModel(engineType, defaultModel)
  return c.json({ success: true as const, data: { engineType, defaultModel } }, 200 as const)
})

// PATCH /api/engines/:engineType/hidden-models — Update hidden models for an engine type
engines.openapi(R.setHiddenModels, async (c) => {
  const engineType = c.req.param('engineType')
  if (!(await isKnownEngineId(engineType))) {
    return c.json({ success: false as const, error: `Unknown engine type: ${engineType}` }, 400 as const)
  }
  const { hiddenModels } = c.req.valid('json')
  await setEngineHiddenModels(engineType, hiddenModels)
  return c.json({ success: true as const, data: { engineType, hiddenModels } }, 200 as const)
})

// GET /api/engines/:engineType/models — List available models for an engine (real or virtual)
engines.openapi(R.getEngineModels, async (c) => {
  const engineType = c.req.param('engineType')
  if (engineRegistry.get(engineType as EngineType)) {
    const models = await getEngineModels(engineType as EngineType)
    const defaultModel = models.find(m => m.isDefault)?.id
    return c.json({ success: true as const, data: { engineType, defaultModel, models } }, 200 as const)
  }

  const virtual = await getVirtualEngine(engineType)
  if (!virtual) {
    return c.json({ success: false as const, error: `Unknown engine type: ${engineType}` }, 400 as const)
  }
  const models = await fetchVirtualEngineModels(virtual)
  const defaultModel = models.find(m => m.isDefault)?.id ?? virtual.model
  return c.json({ success: true as const, data: { engineType, defaultModel, models } }, 200 as const)
})

// POST /api/engines/probe — Force a live re-probe of all engines
engines.openapi(R.probeEngines, async (c) => {
  // Also refresh virtual engines' provider model lists.
  clearVirtualModelCache()
  const result = await forceProbeEngines()
  return c.json({ success: true as const, data: result }, 200)
})

export default engines
