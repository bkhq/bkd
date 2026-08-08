import { describe, expect, test } from 'bun:test'
import { cacheSet } from '@/cache'
import { pickExecutionModel, resolveExecutionModel } from '@/engines/model-resolver'
import type { EngineModel } from '@/engines/types'

const MODELS: EngineModel[] = [
  { id: 'claude-fable-5', name: 'Claude Fable 5', isDefault: false },
  { id: 'claude-opus-5', name: 'Claude Opus 5', isDefault: true },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', isDefault: false },
]

describe('pickExecutionModel', () => {
  test('keeps a model that exists in the list', () => {
    expect(pickExecutionModel(MODELS, 'claude-sonnet-5')).toBe('claude-sonnet-5')
  })

  test('resolves auto to the default model', () => {
    expect(pickExecutionModel(MODELS, 'auto')).toBe('claude-opus-5')
  })

  test('resolves an unknown model to the default model', () => {
    expect(pickExecutionModel(MODELS, 'claude-opus-4-8')).toBe('claude-opus-5')
  })

  test('resolves a missing model to the default model', () => {
    expect(pickExecutionModel(MODELS, undefined)).toBe('claude-opus-5')
  })

  test('returns undefined when the list has no default', () => {
    const noDefault = MODELS.map(m => ({ ...m, isDefault: false }))
    expect(pickExecutionModel(noDefault, 'auto')).toBeUndefined()
  })
})

describe('resolveExecutionModel', () => {
  test('resolves auto/unknown to the engine default', async () => {
    expect(await resolveExecutionModel('claude-code', 'auto')).toBe('claude-opus-5')
    expect(await resolveExecutionModel('claude-code', 'claude-opus-4-8')).toBe('claude-opus-5')
    expect(await resolveExecutionModel('claude-code', 'claude-fable-5')).toBe('claude-fable-5')
  })

  test('claude-code ignores a stale cached model list (static catalog wins)', async () => {
    // Simulate pre-upgrade probe data still present in the cache: the removed
    // model is listed and even marked default.
    await cacheSet(
      'engines:models:claude-code',
      [
        { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', isDefault: true },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', isDefault: false },
      ] satisfies EngineModel[],
      60,
    )
    expect(await resolveExecutionModel('claude-code', 'claude-opus-4-8')).toBe('claude-opus-5')
    expect(await resolveExecutionModel('claude-code', 'auto')).toBe('claude-opus-5')
  })

  test('passes through for virtual engine profiles', async () => {
    await cacheSet('engines:models:claude-code', MODELS, 60)
    expect(await resolveExecutionModel('claude-code', 'provider-model-x', 'vp-1')).toBe(
      'provider-model-x',
    )
    expect(await resolveExecutionModel('claude-code', 'auto', 'vp-1')).toBeUndefined()
  })

  test('passes through when the model list is empty', async () => {
    await cacheSet('engines:models:codex', [], 60)
    expect(await resolveExecutionModel('codex', 'gpt-5.3-codex')).toBe('gpt-5.3-codex')
    expect(await resolveExecutionModel('codex', 'auto')).toBeUndefined()
  })
})
