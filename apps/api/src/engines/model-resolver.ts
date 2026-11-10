import type { EngineModel, EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { getModelConfigs } from './model-configs'
import { getEngineModels } from './startup-probe'

/**
 * Pick the model to execute with: keep a selection that exists in the
 * engine's model list; resolve 'auto', missing, or unknown selections to
 * the list's default model (undefined when the list marks no default —
 * the engine CLI then uses its own default).
 */
export function pickExecutionModel(
  models: EngineModel[],
  model: string | null | undefined,
): string | undefined {
  if (model && model !== 'auto' && models.some(m => m.id === model)) return model
  return models.find(m => m.isDefault)?.id
}

/**
 * Resolve the effective execution model for an engine from probed model data.
 *
 * Pass-through cases (legacy behavior, 'auto' → undefined):
 * - virtual engine profiles — their catalogs come from the provider, not
 *   the engine probe, so the probed list cannot validate them
 * - model list unavailable or empty
 */
export async function resolveExecutionModel(
  engineType: EngineType,
  model: string | null | undefined,
  engineProfileId?: string | null,
): Promise<string | undefined> {
  const passThrough = model === 'auto' ? undefined : (model ?? undefined)
  if (engineProfileId) return passThrough

  let models: EngineModel[]
  try {
    models = await getEngineModels(engineType)
  } catch (error) {
    logger.warn({ engineType, error }, 'model_resolve_list_unavailable')
    return passThrough
  }
  if (!models || models.length === 0) return passThrough

  const resolved = pickExecutionModel(models, model)
  if (resolved !== (model ?? undefined) && model && model !== 'auto') {
    logger.info({ engineType, requested: model, resolved }, 'model_resolve_switched')
  }
  if (resolved && models.find(m => m.id === resolved)?.custom) {
    return (await getModelConfigs(engineType)).find(c => c.id === resolved)?.baseModel ?? resolved
  }
  return resolved
}

/**
 * Env vars configured for the model an execution resolves to (see
 * resolveExecutionModel). Undefined for virtual engine profiles and for
 * models without configured env vars.
 */
export async function resolveModelEnvVars(
  engineType: EngineType,
  model: string | null | undefined,
  engineProfileId?: string | null,
): Promise<Record<string, string> | undefined> {
  if (engineProfileId) return undefined
  try {
    const [models, configs] = await Promise.all([getEngineModels(engineType), getModelConfigs(engineType)])
    const resolved = pickExecutionModel(models, model) ?? model
    const envVars = configs.find(c => c.id === resolved)?.envVars
    return envVars && Object.keys(envVars).length > 0 ? envVars : undefined
  } catch (error) {
    logger.warn({ engineType, error }, 'model_env_resolve_failed')
    return undefined
  }
}
