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
import { forceProbeEngines, getEngineDiscovery, getEngineModels } from '@/engines/startup-probe'
import { BUILT_IN_PROFILES } from '@/engines/types'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'

const ENGINE_TYPES = ['claude-code', 'claude-code-sdk', 'codex'] as const

const engineTypeEnum = z.enum(ENGINE_TYPES)

const engines = createOpenAPIRouter()

// GET /api/engines/available — List detected engines + models (cache → DB → live probe)
engines.openapi(R.getAvailableEngines, async (c) => {
  const { engines, models } = await getEngineDiscovery()
  return c.json({ success: true, data: { engines, models } })
})

// GET /api/engines/profiles — List engine profiles
engines.openapi(R.getEngineProfiles, (c) => {
  const profiles = Object.values(BUILT_IN_PROFILES)
  return c.json({ success: true, data: profiles })
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
  return c.json({ success: true, data: { defaultEngine, engines } })
})

// PATCH /api/engines/default-engine — Update global default engine
engines.openapi(R.setDefaultEngine, async (c) => {
  const { defaultEngine } = c.req.valid('json')
  const parsed = engineTypeEnum.safeParse(defaultEngine)
  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid engine type' }, 400 as const)
  }
  await setDefaultEngine(defaultEngine)
  return c.json({ success: true, data: { defaultEngine } }, 200 as const)
})

// PATCH /api/engines/:engineType/settings — Upsert default model for an engine type
engines.openapi(R.setEngineModel, async (c) => {
  const rawType = c.req.param('engineType')
  const parsed = engineTypeEnum.safeParse(rawType)
  if (!parsed.success) {
    return c.json({ success: false, error: `Unknown engine type: ${rawType}` }, 400 as const)
  }
  const engineType = parsed.data
  const { defaultModel } = c.req.valid('json')
  await setEngineDefaultModel(engineType, defaultModel)
  return c.json({ success: true, data: { engineType, defaultModel } }, 200 as const)
})

// PATCH /api/engines/:engineType/hidden-models — Update hidden models for an engine type
engines.openapi(R.setHiddenModels, async (c) => {
  const rawType = c.req.param('engineType')
  const parsed = engineTypeEnum.safeParse(rawType)
  if (!parsed.success) {
    return c.json({ success: false, error: `Unknown engine type: ${rawType}` }, 400 as const)
  }
  const engineType = parsed.data
  const { hiddenModels } = c.req.valid('json')
  await setEngineHiddenModels(engineType, hiddenModels)
  return c.json({ success: true, data: { engineType, hiddenModels } }, 200 as const)
})

// GET /api/engines/:engineType/models — List available models for an engine
engines.openapi(R.getEngineModels, async (c) => {
  const rawType = c.req.param('engineType')
  const parsed = engineTypeEnum.safeParse(rawType)
  if (!parsed.success) {
    return c.json({ success: false, error: `Unknown engine type: ${rawType}` }, 400 as const)
  }
  const engineType = parsed.data
  const executor = engineRegistry.get(engineType)
  if (!executor) {
    return c.json({ success: false, error: `Unknown engine type: ${engineType}` }, 404 as const)
  }

  const models = await getEngineModels(engineType)
  const defaultModel = models.find(m => m.isDefault)?.id

  return c.json({
    success: true,
    data: { engineType, defaultModel, models },
  }, 200 as const)
})

// POST /api/engines/probe — Force a live re-probe of all engines
engines.openapi(R.probeEngines, async (c) => {
  const result = await forceProbeEngines()
  return c.json({ success: true, data: result })
})

export default engines
