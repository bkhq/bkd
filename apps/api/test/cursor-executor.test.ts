import { describe, expect, test } from 'bun:test'
import { buildCursorArgs, parseCursorModels, parseCursorStatus } from '@/engines/executors/cursor'

describe('buildCursorArgs', () => {
  const base = { workingDir: '/repo', prompt: 'fix the bug' }

  test('first turn creates the session from the pre-generated id', () => {
    expect(buildCursorArgs({ ...base, externalSessionId: 'uuid-1' })).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--force',
      '--trust',
      '--workspace',
      '/repo',
      '--resume',
      'uuid-1',
      'fix the bug',
    ])
  })

  test('follow-up resumes the stored session, not the new id', () => {
    const args = buildCursorArgs({ ...base, externalSessionId: 'uuid-new', sessionId: 'uuid-1' })
    expect(args).toContain('uuid-1')
    expect(args).not.toContain('uuid-new')
  })

  test('passes the model when set', () => {
    const args = buildCursorArgs({ ...base, model: 'gpt-5.2' })
    expect(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2)).toEqual(['--model', 'gpt-5.2'])
    expect(buildCursorArgs(base)).not.toContain('--model')
  })

  test('the prompt is always the last argument', () => {
    const args = buildCursorArgs({ ...base, model: 'auto', prompt: '--not-a-flag' })
    expect(args.at(-1)).toBe('--not-a-flag')
  })
})

describe('parseCursorModels', () => {
  test('reads ids, labels and the default marker', () => {
    const out = 'Available models\n\nauto - Auto (default)\ngpt-5.2 - GPT-5.2\ncomposer-2.5 - Composer 2.5\n'
    expect(parseCursorModels(out)).toEqual([
      { id: 'auto', name: 'Auto', isDefault: true },
      { id: 'gpt-5.2', name: 'GPT-5.2', isDefault: false },
      { id: 'composer-2.5', name: 'Composer 2.5', isDefault: false },
    ])
  })

  test('strips the current/default marker', () => {
    const out = 'Available models\n\nauto - Auto (current, default)\ngpt-5.2 - GPT-5.2 (current)\n'
    expect(parseCursorModels(out)).toEqual([
      { id: 'auto', name: 'Auto', isDefault: true },
      { id: 'gpt-5.2', name: 'GPT-5.2', isDefault: false },
    ])
  })

  test('unknown output yields no models', () => {
    expect(parseCursorModels('Error: Authentication required.')).toEqual([])
  })
})

describe('parseCursorStatus', () => {
  test('reads the authenticated flag from status --format json', () => {
    expect(parseCursorStatus('{"status":"authenticated","isAuthenticated":true}')).toBe('authenticated')
    expect(parseCursorStatus('{"status":"unauthenticated","isAuthenticated":false,"message":"Not logged in"}')).toBe('unauthenticated')
  })

  test('unparseable output is unknown', () => {
    expect(parseCursorStatus('Not logged in')).toBe('unknown')
    expect(parseCursorStatus('{}')).toBe('unknown')
  })
})
