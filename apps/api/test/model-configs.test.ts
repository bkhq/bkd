import type { ModelConfig } from '@bkd/shared'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cacheSet } from '@/cache'
import { resolveExecEnvVars } from '@/engines/issue/utils/helpers'
import { applyModelConfigs } from '@/engines/model-configs'
import { resolveExecutionModel, resolveModelEnvVars } from '@/engines/model-resolver'
import type { EngineModel } from '@/engines/types'
import { api, expectError, expectSuccess, get } from './helpers'
import './setup'

const DETECTED: EngineModel[] = [
  { id: 'claude-opus-5-5', name: 'Opus 5.5', isDefault: true },
  { id: 'claude-fable-5-2', name: 'Fable 5.2', isDefault: false },
]

const CONFIGS: ModelConfig[] = [
  { id: 'claude-opus-5-5', name: 'Opus (team)', envVars: { CLAUDE_CODE_EFFORT_LEVEL: 'medium' } },
  { id: 'fable-high', name: 'Fable 5.2 high', baseModel: 'claude-fable-5-2', envVars: { CLAUDE_CODE_EFFORT_LEVEL: 'high' } },
]

function putConfigs(engineType: string, configs: ModelConfig[]) {
  return api<ModelConfig[]>('PUT', `/api/engines/${engineType}/model-configs`, { configs })
}

beforeEach(async () => {
  await cacheSet('engines:models:claude-code', DETECTED, 600)
})

afterEach(async () => {
  await putConfigs('claude-code', [])
})

describe('applyModelConfigs', () => {
  test('renames detected models and appends custom models', () => {
    expect(applyModelConfigs(DETECTED, CONFIGS)).toEqual([
      { id: 'claude-opus-5-5', name: 'Opus (team)', isDefault: true },
      { id: 'claude-fable-5-2', name: 'Fable 5.2', isDefault: false },
      { id: 'fable-high', name: 'Fable 5.2 high', isDefault: false, custom: true },
    ])
  })

  test('ignores overrides of models that are not detected, and custom ids now detected', () => {
    const models = applyModelConfigs(DETECTED, [
      { id: 'gone', name: 'Gone', envVars: {} },
      { id: 'claude-fable-5-2', baseModel: 'claude-opus-5-5', envVars: {} },
    ])
    expect(models.map(m => m.id)).toEqual(['claude-opus-5-5', 'claude-fable-5-2'])
    expect(models.every(m => !m.custom)).toBe(true)
  })

  test('falls back to the id when a custom model has no name', () => {
    const models = applyModelConfigs([], [{ id: 'x', baseModel: 'claude-opus-5-5', envVars: {} }])
    expect(models).toEqual([{ id: 'x', name: 'x', isDefault: false, custom: true }])
  })
})

describe('PUT/GET /api/engines/:engineType/model-configs', () => {
  test('saves configs and merges them into the model list', async () => {
    expect(expectSuccess(await putConfigs('claude-code', CONFIGS))).toEqual(CONFIGS)
    const all = expectSuccess(await get<Record<string, ModelConfig[]>>('/api/engines/model-configs'))
    expect(all['claude-code']).toEqual(CONFIGS)

    const { models } = expectSuccess(await get<{ models: EngineModel[] }>('/api/engines/claude-code/models'))
    expect(models.map(m => m.name)).toEqual(['Opus (team)', 'Fable 5.2', 'Fable 5.2 high'])
    expect(models.find(m => m.id === 'fable-high')?.custom).toBe(true)
  })

  test('rejects a custom model id that collides with a detected model', async () => {
    expectError(await putConfigs('claude-code', [{ id: 'claude-opus-5-5', baseModel: 'claude-fable-5-2', envVars: {} }]), 400)
  })

  test('rejects duplicate ids and invalid env var names', async () => {
    expectError(await putConfigs('claude-code', [CONFIGS[1]!, CONFIGS[1]!]), 400)
    expectError(await putConfigs('claude-code', [{ id: 'a', baseModel: 'b', envVars: { '1BAD': 'x' } }]), 400)
  })

  test('rejects an unknown engine type', async () => {
    expectError(await putConfigs('nope', []), 400)
  })
})

describe('execution resolution', () => {
  beforeEach(async () => {
    await putConfigs('claude-code', CONFIGS)
  })

  test('a custom model runs its base model with its env vars', async () => {
    expect(await resolveExecutionModel('claude-code', 'fable-high')).toBe('claude-fable-5-2')
    expect(await resolveModelEnvVars('claude-code', 'fable-high')).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: 'high' })
  })

  test('an overridden detected model keeps its id and applies its env vars', async () => {
    expect(await resolveExecutionModel('claude-code', 'claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(await resolveModelEnvVars('claude-code', 'auto')).toEqual({ CLAUDE_CODE_EFFORT_LEVEL: 'medium' })
  })

  test('a model without config and a virtual profile get no model env vars', async () => {
    expect(await resolveModelEnvVars('claude-code', 'claude-fable-5-2')).toBeUndefined()
    expect(await resolveModelEnvVars('claude-code', 'fable-high', 'vp-1')).toBeUndefined()
  })

  test('model env vars sit between project and virtual-engine env vars', async () => {
    const env = await resolveExecEnvVars(null, { A: 'project', CLAUDE_CODE_EFFORT_LEVEL: 'low' }, { CLAUDE_CODE_EFFORT_LEVEL: 'high' })
    expect(env).toEqual({ A: 'project', CLAUDE_CODE_EFFORT_LEVEL: 'high' })
  })
})
