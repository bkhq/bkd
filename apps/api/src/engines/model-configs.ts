import type { ModelConfig } from '@bkd/shared'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import { logger } from '@/logger'
import type { EngineModel } from './types'

export const MODEL_CONFIGS_KEY = 'engine:modelConfigs'

const ID_PATTERN = /^[\w.\-:[\]]{1,64}$/
const ENV_KEY_PATTERN = /^[A-Z_]\w*$/i

export type { ModelConfig }

export class ModelConfigError extends Error {}

function sanitizeStored(raw: unknown): ModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || !ID_PATTERN.test(e.id)) return null
  const envVars: Record<string, string> = {}
  if (e.envVars && typeof e.envVars === 'object' && !Array.isArray(e.envVars)) {
    for (const [k, v] of Object.entries(e.envVars as Record<string, unknown>)) {
      if (ENV_KEY_PATTERN.test(k)) envVars[k] = String(v)
    }
  }
  return {
    id: e.id,
    ...(typeof e.name === 'string' && e.name.trim() && { name: e.name.trim() }),
    ...(typeof e.baseModel === 'string' && e.baseModel.trim() && { baseModel: e.baseModel.trim() }),
    envVars,
  }
}

/** All stored model configs, keyed by engine type. Drops malformed entries. */
export async function getAllModelConfigs(): Promise<Record<string, ModelConfig[]>> {
  const raw = await getAppSetting(MODEL_CONFIGS_KEY)
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, ModelConfig[]> = {}
  for (const [engineType, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const configs = list.map(sanitizeStored).filter((c): c is ModelConfig => c !== null)
    if (configs.length > 0) out[engineType] = configs
  }
  return out
}

export async function getModelConfigs(engineType: string): Promise<ModelConfig[]> {
  return (await getAllModelConfigs())[engineType] ?? []
}

/**
 * Validate and replace one engine's model configs. A custom model (with
 * `baseModel`) must not reuse a detected model id.
 */
export async function setModelConfigs(
  engineType: string,
  list: ModelConfig[],
  detectedIds: string[],
): Promise<ModelConfig[]> {
  const detected = new Set(detectedIds)
  const seen = new Set<string>()
  const cleaned: ModelConfig[] = []

  for (const c of list) {
    const id = String(c?.id ?? '').trim()
    if (!ID_PATTERN.test(id)) throw new ModelConfigError(`Invalid model id: ${JSON.stringify(c?.id)}`)
    if (seen.has(id)) throw new ModelConfigError(`Duplicate model id: ${id}`)
    seen.add(id)

    const baseModel = c.baseModel?.trim()
    if (baseModel && detected.has(id)) {
      throw new ModelConfigError(`Custom model id collides with a detected model: ${id}`)
    }
    const name = c.name?.trim()
    if (name && name.length > 100) throw new ModelConfigError(`Model name must be at most 100 chars: ${id}`)

    const envVars: Record<string, string> = {}
    for (const [key, value] of Object.entries(c.envVars ?? {})) {
      if (!ENV_KEY_PATTERN.test(key)) {
        throw new ModelConfigError(`Invalid env var name "${key}" for model ${id}`)
      }
      envVars[key] = String(value)
    }
    cleaned.push({ id, ...(name && { name }), ...(baseModel && { baseModel }), envVars })
  }

  const all = await getAllModelConfigs()
  if (cleaned.length > 0) all[engineType] = cleaned
  else delete all[engineType]
  await setAppSetting(MODEL_CONFIGS_KEY, JSON.stringify(all))
  logger.info({ engineType, count: cleaned.length }, 'model_configs_saved')
  return cleaned
}

/**
 * Merge configs into a detected model list: overrides rename detected models,
 * custom models are appended. Configs whose id is not detected and that have
 * no `baseModel` are ignored.
 */
export function applyModelConfigs(models: EngineModel[], configs: ModelConfig[]): EngineModel[] {
  if (configs.length === 0) return models
  const byId = new Map(configs.map(c => [c.id, c]))
  const detected = new Set(models.map(m => m.id))
  const out = models.map((m) => {
    const name = byId.get(m.id)?.name
    return name ? { ...m, name } : m
  })
  for (const c of configs) {
    if (c.baseModel && !detected.has(c.id)) {
      out.push({ id: c.id, name: c.name ?? c.id, isDefault: false, custom: true })
    }
  }
  return out
}
