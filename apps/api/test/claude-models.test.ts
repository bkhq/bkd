import { describe, expect, test } from 'bun:test'
import { mapInitModels } from '@/engines/executors/claude/executor'

// Trimmed from a real `initialize` control response (Claude Code 2.1.322).
const INIT_MODELS = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks' },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work and everyday tasks' },
  { value: 'fable', resolvedModel: 'claude-fable-5-2', displayName: 'Fable 5.2', description: 'For your toughest challenges' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'Most efficient for simpler tasks' },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: 'Fastest for quick answers' },
  { value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5' },
]

describe('mapInitModels', () => {
  test('uses full model IDs, deduplicated, with the CLI default marked', () => {
    const models = mapInitModels(INIT_MODELS)
    const base = models.filter(m => !m.id.endsWith('[1m]'))
    expect(base.map(m => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-fable-5-2',
      'claude-sonnet-5-5',
    ])
    expect(base[0]).toEqual({
      id: 'claude-opus-5-5',
      name: 'Opus 5.5',
      description: 'For complex work and everyday tasks',
      isDefault: true,
    })
    expect(models.filter(m => m.isDefault).map(m => m.id)).toEqual(['claude-opus-5-5'])
  })

  test('adds a [1m] variant after each Opus, Sonnet and Fable model', () => {
    const ids = mapInitModels(INIT_MODELS).map(m => m.id)
    expect(ids).toEqual([
      'claude-opus-5-5',
      'claude-opus-5-5[1m]',
      'claude-fable-5-2',
      'claude-fable-5-2[1m]',
      'claude-sonnet-5-5',
      'claude-sonnet-5-5[1m]',
    ])
    const oneM = mapInitModels(INIT_MODELS).find(m => m.id === 'claude-sonnet-5-5[1m]')
    expect(oneM).toEqual({ id: 'claude-sonnet-5-5[1m]', name: 'Sonnet 5.5 (1M)', description: 'Most efficient for simpler tasks', isDefault: false })
  })

  test('falls back to value and ID when fields are missing, and skips malformed entries', () => {
    const models = mapInitModels([
      { value: 'claude-x-1' },
      { displayName: 'No id' },
      null,
      'opus',
    ])
    expect(models).toEqual([{ id: 'claude-x-1', name: 'claude-x-1', isDefault: false }])
  })

  test('leaves out Haiku models, even when the CLI default is one', () => {
    const models = mapInitModels([
      { value: 'default', resolvedModel: 'claude-haiku-5-5' },
      { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5' },
      { value: 'claude-x-1' },
    ])
    expect(models).toEqual([{ id: 'claude-x-1', name: 'claude-x-1', isDefault: false }])
  })

  test('leaves out Opus 4.x and Opus 5, keeping Opus 5.5', () => {
    const ids = mapInitModels([
      { value: 'claude-opus-5', resolvedModel: 'claude-opus-5' },
      { value: 'claude-opus-4-8', resolvedModel: 'claude-opus-4-8' },
      { value: 'claude-opus-4-6', resolvedModel: 'claude-opus-4-6' },
      { value: 'opus', resolvedModel: 'claude-opus-5-5' },
    ]).map(m => m.id)
    expect(ids).toEqual(['claude-opus-5-5', 'claude-opus-5-5[1m]'])
  })

  test('leaves out Sonnet 4.x and Sonnet 5, keeping Sonnet 5.5', () => {
    const ids = mapInitModels([
      { value: 'claude-sonnet-5', resolvedModel: 'claude-sonnet-5' },
      { value: 'claude-sonnet-4-6', resolvedModel: 'claude-sonnet-4-6' },
      { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5' },
    ]).map(m => m.id)
    expect(ids).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5-5[1m]'])
  })

  test('leaves out Fable 5, keeping Fable 5.1 and 5.2', () => {
    const ids = mapInitModels([
      { value: 'fable', resolvedModel: 'claude-fable-5-2' },
      { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1' },
      { value: 'claude-fable-5', resolvedModel: 'claude-fable-5' },
    ]).map(m => m.id)
    expect(ids).toEqual(['claude-fable-5-2', 'claude-fable-5-2[1m]', 'claude-fable-5-1', 'claude-fable-5-1[1m]'])
  })

  test('returns an empty list for a non-array payload', () => {
    expect(mapInitModels(undefined)).toEqual([])
    expect(mapInitModels({})).toEqual([])
  })
})
