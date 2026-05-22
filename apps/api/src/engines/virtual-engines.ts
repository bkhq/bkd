import type { VirtualEngine } from '@bkd/shared'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import { logger } from '@/logger'
import { engineRegistry } from './executors'
import type { EngineAvailability, EngineModel, EngineProfile, EngineType } from './types'

export const VIRTUAL_ENGINES_KEY = 'engine:virtualEngines'

/** Reserved ids that cannot be used as a virtual engine id (real engine types). */
const RESERVED_IDS = new Set<string>(['claude-code', 'codex'])

const ID_PATTERN = /^[\w.\-:]{1,64}$/
const ENV_KEY_PATTERN = /^[A-Z_]\w*$/i

export type { VirtualEngine }

/**
 * Coerce one persisted entry into a valid VirtualEngine, or null if it is
 * unusable. Defends against malformed/partial stored JSON (hand-edited settings,
 * older shapes) so downstream code never sees a half-formed engine.
 */
function sanitizeStored(raw: unknown): VirtualEngine | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const id = typeof e.id === 'string' ? e.id : ''
  if (!ID_PATTERN.test(id) || RESERVED_IDS.has(id)) return null
  const baseEngine = e.baseEngine as EngineType
  if (!engineRegistry.get(baseEngine)) return null

  const envVars: Record<string, string> = {}
  if (e.envVars && typeof e.envVars === 'object' && !Array.isArray(e.envVars)) {
    for (const [k, v] of Object.entries(e.envVars as Record<string, unknown>)) {
      if (ENV_KEY_PATTERN.test(k)) envVars[k] = String(v)
    }
  }
  return {
    id,
    name: typeof e.name === 'string' && e.name.trim() ? e.name : id,
    baseEngine,
    baseUrl: typeof e.baseUrl === 'string' && e.baseUrl ? e.baseUrl : undefined,
    authToken: typeof e.authToken === 'string' && e.authToken ? e.authToken : undefined,
    model: typeof e.model === 'string' && e.model ? e.model : undefined,
    envVars,
  }
}

/** Read all configured virtual engines. Drops unset/malformed entries. */
export async function getVirtualEngines(): Promise<VirtualEngine[]> {
  const raw = await getAppSetting(VIRTUAL_ENGINES_KEY)
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: VirtualEngine[] = []
  for (const entry of parsed) {
    const ve = sanitizeStored(entry)
    if (ve) out.push(ve)
  }
  return out
}

/** An engine id is valid if it is a registered real engine or a configured virtual engine. */
export async function isKnownEngineId(id: string): Promise<boolean> {
  if (engineRegistry.get(id as EngineType)) return true
  return !!(await getVirtualEngine(id))
}

export async function getVirtualEngine(id: string): Promise<VirtualEngine | undefined> {
  const list = await getVirtualEngines()
  return list.find(v => v.id === id)
}

/**
 * Validate and persist the full virtual-engine list (replace semantics).
 * Throws on the first validation error.
 */
export async function setVirtualEngines(list: VirtualEngine[]): Promise<VirtualEngine[]> {
  const seen = new Set<string>()
  const cleaned: VirtualEngine[] = []

  for (const ve of list) {
    const id = String(ve?.id ?? '').trim()
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Invalid virtual engine id: ${JSON.stringify(ve?.id)}`)
    }
    if (RESERVED_IDS.has(id)) {
      throw new Error(`Virtual engine id collides with a built-in engine: ${id}`)
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate virtual engine id: ${id}`)
    }
    seen.add(id)

    const name = String(ve?.name ?? '').trim()
    if (!name || name.length > 100) {
      throw new Error(`Virtual engine name must be 1-100 chars: ${id}`)
    }

    const baseEngine = ve?.baseEngine as EngineType
    if (!engineRegistry.get(baseEngine)) {
      throw new Error(`Unknown base engine for virtual engine ${id}: ${baseEngine}`)
    }

    const envVars: Record<string, string> = {}
    const rawEnv = ve?.envVars ?? {}
    if (typeof rawEnv !== 'object' || Array.isArray(rawEnv)) {
      throw new TypeError(`Virtual engine envVars must be an object: ${id}`)
    }
    for (const [key, value] of Object.entries(rawEnv)) {
      if (!ENV_KEY_PATTERN.test(key)) {
        throw new Error(`Invalid env var name "${key}" for virtual engine ${id}`)
      }
      envVars[key] = String(value)
    }

    const baseUrl = ve?.baseUrl ? String(ve.baseUrl).trim() : undefined
    if (baseUrl) {
      try {
        // eslint-disable-next-line no-new
        new URL(baseUrl)
      } catch {
        throw new Error(`Invalid baseUrl for virtual engine ${id}: ${baseUrl}`)
      }
    }
    const authToken = ve?.authToken ? String(ve.authToken).trim() : undefined
    const model = ve?.model ? String(ve.model).trim() : undefined
    cleaned.push({
      id,
      name,
      baseEngine,
      baseUrl: baseUrl || undefined,
      authToken: authToken || undefined,
      model: model || undefined,
      envVars,
    })
  }

  await setAppSetting(VIRTUAL_ENGINES_KEY, JSON.stringify(cleaned))
  clearVirtualModelCache()
  logger.info({ count: cleaned.length }, 'virtual_engines_saved')
  return cleaned
}

/** The two env keys a virtual engine's link info maps to. */
function linkEnv(ve: VirtualEngine): Record<string, string> {
  const env: Record<string, string> = {}
  if (ve.baseUrl) env.ANTHROPIC_BASE_URL = ve.baseUrl
  if (ve.authToken) env.ANTHROPIC_AUTH_TOKEN = ve.authToken
  return env
}

/**
 * Resolve the env vars to inject for an issue's virtual engine.
 * Returns undefined when the issue has no virtual engine (or it was deleted).
 */
export async function resolveProfileEnvVars(
  engineProfileId: string | null | undefined,
): Promise<Record<string, string> | undefined> {
  if (!engineProfileId) return undefined
  const ve = await getVirtualEngine(engineProfileId)
  if (!ve) {
    logger.warn({ engineProfileId }, 'virtual_engine_not_found_for_issue')
    return undefined
  }
  // Dedicated link fields (baseUrl/authToken) win over advanced envVars.
  const merged = { ...ve.envVars, ...linkEnv(ve) }
  return Object.keys(merged).length > 0 ? merged : undefined
}

// ---------- Model discovery ----------

const MODEL_CACHE_TTL_MS = 10 * 60 * 1000
const MODEL_FETCH_TIMEOUT_MS = 8000
const modelCache = new Map<string, { at: number, models: EngineModel[] }>()

/** Drop cached provider model lists (called when the config changes / on re-probe). */
export function clearVirtualModelCache(): void {
  modelCache.clear()
}

/**
 * Build the OpenAI-style models URL from a provider base.
 * `https://h`        -> `https://h/v1/models`
 * `https://h/`       -> `https://h/v1/models`
 * `https://h/v1`     -> `https://h/v1/models`
 */
function modelsUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`
}

/**
 * Fetch the provider's model list (`{baseUrl}/v1/models`, OpenAI format) for a
 * virtual engine. Cached per-id with a TTL. Returns [] on any failure so the
 * caller can fall back to the optional manual `model`.
 */
export async function fetchVirtualEngineModels(ve: VirtualEngine): Promise<EngineModel[]> {
  const base = ve.baseUrl ?? ve.envVars.ANTHROPIC_BASE_URL
  const token = ve.authToken ?? ve.envVars.ANTHROPIC_AUTH_TOKEN
  if (!base) return []

  const cached = modelCache.get(ve.id)
  if (cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS) return cached.models

  try {
    const res = await fetch(modelsUrl(base), {
      method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      redirect: 'error',
      signal: AbortSignal.timeout(MODEL_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.warn({ id: ve.id, status: res.status }, 'virtual_engine_models_fetch_failed')
      modelCache.set(ve.id, { at: Date.now(), models: [] })
      return []
    }
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> }
    const models: EngineModel[] = (body.data ?? [])
      .map(m => (typeof m.id === 'string' ? m.id : null))
      .filter((id): id is string => !!id)
      .map(id => ({ id, name: id, isDefault: id === ve.model }))
    modelCache.set(ve.id, { at: Date.now(), models })
    return models
  } catch (error) {
    logger.warn(
      { id: ve.id, error: error instanceof Error ? error.message : String(error) },
      'virtual_engine_models_fetch_error',
    )
    modelCache.set(ve.id, { at: Date.now(), models: [] })
    return []
  }
}

/**
 * Append virtual engines to a base engine discovery result so they appear as
 * selectable engines. A virtual engine mirrors its base engine's installed /
 * executable / auth status, and exposes models fetched from its provider
 * (`{baseUrl}/v1/models`), falling back to the optional manual `model`.
 */
export async function decorateDiscoveryWithVirtual(discovery: {
  engines: EngineAvailability[]
  models: Record<string, EngineModel[]>
}): Promise<{ engines: EngineAvailability[], models: Record<string, EngineModel[]> }> {
  const virtuals = await getVirtualEngines()
  if (virtuals.length === 0) return discovery

  const engines = [...discovery.engines]
  const models: Record<string, EngineModel[]> = { ...discovery.models }

  const fetched = await Promise.all(virtuals.map(ve => fetchVirtualEngineModels(ve)))

  virtuals.forEach((ve, i) => {
    const base = discovery.engines.find(e => e.engineType === ve.baseEngine)
    // A virtual engine authenticates with its own token (baseUrl + authToken),
    // so its auth status comes from its own credentials — not the base engine's
    // local auth (which would wrongly hide it from the UI when the base CLI is
    // locally unauthenticated).
    const hasOwnAuth = !!(ve.authToken || ve.envVars.ANTHROPIC_AUTH_TOKEN)
    engines.push({
      // engineType holds the virtual id; the wire schema is z.string().
      engineType: ve.id as EngineType,
      installed: base?.installed ?? false,
      executable: base?.executable,
      version: base?.version,
      binaryPath: base?.binaryPath,
      authStatus: hasOwnAuth ? 'authenticated' : (base?.authStatus ?? 'unknown'),
    })
    const discovered = fetched[i] ?? []
    models[ve.id] = discovered.length > 0
      ? discovered
      : ve.model
        ? [{ id: ve.model, name: ve.model, isDefault: true }]
        : []
  })

  return { engines, models }
}

/** Build EngineProfile entries for virtual engines (display metadata). */
export async function getVirtualEngineProfiles(): Promise<EngineProfile[]> {
  const virtuals = await getVirtualEngines()
  return virtuals.map(ve => ({
    engineType: ve.id as EngineType,
    name: ve.name,
    baseCommand: '',
    protocol: 'stream-json',
    capabilities: [],
    permissionPolicy: 'auto',
    defaultModel: ve.model,
  }))
}
