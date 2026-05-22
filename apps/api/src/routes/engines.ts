import type { VirtualEngine } from '@bkd/shared'
import { zValidator } from '@hono/zod-validator'
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

const ENGINE_TYPES = ['claude-code', 'codex'] as const

const engines = createOpenAPIRouter()

// GET /api/engines/available — List detected engines + models (cache → DB → live probe)
// Virtual engines are appended on top of the base discovery (not cached with it).
engines.openapi(R.getAvailableEngines, async (c) => {
  const base = await getEngineDiscovery()
  const { engines, models } = await decorateDiscoveryWithVirtual(base)
  return c.json({ success: true, data: { engines, models } })
})

// GET /api/engines/profiles — List engine profiles (built-in + virtual)
engines.openapi(R.getEngineProfiles, async (c) => {
  const profiles = [...Object.values(BUILT_IN_PROFILES), ...(await getVirtualEngineProfiles())]
  return c.json({ success: true, data: profiles })
})

// --- Virtual engines (claude-code executor + preset env vars) ---

const virtualEngineSchema = z.object({
  id: z.string().regex(/^[\w.\-:]{1,64}$/),
  name: z.string().min(1).max(100),
  baseEngine: z.enum(ENGINE_TYPES),
  baseUrl: z.string().url().max(512).optional(),
  authToken: z.string().max(512).optional(),
  model: z.string().max(160).optional(),
  envVars: z.record(z.string(), z.string()).refine(
    obj => Object.keys(obj).length <= 50,
    { message: 'Maximum 50 environment variables allowed' },
  ),
})

// GET /api/engines/virtual — List configured virtual engines
engines.get('/virtual', async (c) => {
  const list = await getVirtualEngines()
  return c.json({ success: true, data: list })
})

// PUT /api/engines/virtual — Replace the full virtual engine list
engines.put(
  '/virtual',
  zValidator(
    'json',
    z.object({ engines: z.array(virtualEngineSchema).max(50) }),
    (result, c) => {
      if (!result.success) {
        return c.json(
          { success: false, error: result.error.issues.map(i => i.message).join(', ') },
          400,
        )
      }
    },
  ),
  async (c) => {
    const { engines: list } = c.req.valid('json')
    try {
      const saved = await setVirtualEngines(list as VirtualEngine[])
      return c.json({ success: true, data: saved })
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : 'Invalid virtual engines' },
        400,
      )
    }
  },
)

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
// Accepts a real engine type or a configured virtual engine id.
engines.openapi(R.setDefaultEngine, async (c) => {
  const { defaultEngine } = c.req.valid('json')
  if (!(await isKnownEngineId(defaultEngine))) {
    return c.json({ success: false, error: 'Invalid engine type' }, 400 as const)
  }
  await setDefaultEngine(defaultEngine)
  return c.json({ success: true, data: { defaultEngine } }, 200 as const)
})

// PATCH /api/engines/:engineType/settings — Upsert default model for an engine type
engines.openapi(R.setEngineModel, async (c) => {
  const engineType = c.req.param('engineType')
  if (!(await isKnownEngineId(engineType))) {
    return c.json({ success: false, error: `Unknown engine type: ${engineType}` }, 400 as const)
  }
  const { defaultModel } = c.req.valid('json')
  await setEngineDefaultModel(engineType, defaultModel)
  return c.json({ success: true, data: { engineType, defaultModel } }, 200 as const)
})

// PATCH /api/engines/:engineType/hidden-models — Update hidden models for an engine type
engines.openapi(R.setHiddenModels, async (c) => {
  const engineType = c.req.param('engineType')
  if (!(await isKnownEngineId(engineType))) {
    return c.json({ success: false, error: `Unknown engine type: ${engineType}` }, 400 as const)
  }
  const { hiddenModels } = c.req.valid('json')
  await setEngineHiddenModels(engineType, hiddenModels)
  return c.json({ success: true, data: { engineType, hiddenModels } }, 200 as const)
})

// GET /api/engines/:engineType/models — List available models for an engine (real or virtual)
engines.openapi(R.getEngineModels, async (c) => {
  const engineType = c.req.param('engineType')
  if (engineRegistry.get(engineType as EngineType)) {
    const models = await getEngineModels(engineType as EngineType)
    const defaultModel = models.find(m => m.isDefault)?.id
    return c.json({ success: true, data: { engineType, defaultModel, models } }, 200 as const)
  }

  const virtual = await getVirtualEngine(engineType)
  if (!virtual) {
    return c.json({ success: false, error: `Unknown engine type: ${engineType}` }, 400 as const)
  }
  const models = await fetchVirtualEngineModels(virtual)
  const defaultModel = models.find(m => m.isDefault)?.id ?? virtual.model
  return c.json({ success: true, data: { engineType, defaultModel, models } }, 200 as const)
})

// POST /api/engines/probe — Force a live re-probe of all engines
engines.openapi(R.probeEngines, async (c) => {
  // Also refresh virtual engines' provider model lists.
  clearVirtualModelCache()
  const result = await forceProbeEngines()
  return c.json({ success: true, data: result })
})

export default engines
