import { describe, expect, it } from 'vitest'
import { resolveDefaultEngine } from '../../lib/engine-defaults'

const installed = [{ engineType: 'claude-code' }, { engineType: 'codex' }]

describe('resolveDefaultEngine', () => {
  it('prefers an explicit user selection over everything', () => {
    expect(resolveDefaultEngine('codex', 'claude-code', 'claude-code', installed)).toBe('codex')
  })

  it('uses the project default when the user made no selection (ENG-012)', () => {
    expect(resolveDefaultEngine('', 'codex', 'claude-code', installed)).toBe('codex')
  })

  it('falls back to the global default when no project default', () => {
    expect(resolveDefaultEngine('', null, 'codex', installed)).toBe('codex')
  })

  it('falls back to the first installed engine when nothing else applies', () => {
    expect(resolveDefaultEngine('', null, null, installed)).toBe('claude-code')
  })

  it('skips a project default that is not installed', () => {
    expect(resolveDefaultEngine('', 'codex', 'claude-code', [{ engineType: 'claude-code' }]))
      .toBe('claude-code')
  })

  it('returns empty string when no engines are installed', () => {
    expect(resolveDefaultEngine('', 'codex', 'claude-code', [])).toBe('')
  })
})
