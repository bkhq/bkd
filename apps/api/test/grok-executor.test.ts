import { describe, expect, test } from 'bun:test'
import { buildGrokArgs, parseGrokModels } from '@/engines/executors/grok'

describe('buildGrokArgs', () => {
  const base = { workingDir: '/repo', prompt: 'fix the bug' }

  test('first turn names a new session with -s', () => {
    expect(buildGrokArgs({ ...base, externalSessionId: 'uuid-1' })).toEqual([
      '-p',
      'fix the bug',
      '--output-format',
      'streaming-messages-json',
      '--include-partial-messages',
      '--permission-mode',
      'bypassPermissions',
      '--cwd',
      '/repo',
      '-s',
      'uuid-1',
    ])
  })

  test('follow-up resumes with -r and never passes -s', () => {
    const args = buildGrokArgs({ ...base, externalSessionId: 'uuid-new', sessionId: 'uuid-1' })
    expect(args.slice(-2)).toEqual(['-r', 'uuid-1'])
    expect(args).not.toContain('-s')
  })

  test('passes an explicit model, skips auto', () => {
    expect(buildGrokArgs({ ...base, model: 'grok-4.7' })).toContain('grok-4.7')
    const auto = buildGrokArgs({ ...base, model: 'auto' })
    expect(auto).not.toContain('-m')
  })

  test('passes the agent name', () => {
    const args = buildGrokArgs({ ...base, agent: 'reviewer' })
    expect(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2)).toEqual(['--agent', 'reviewer'])
  })
})

describe('parseGrokModels', () => {
  test('reads auth status and models from `grok models`', () => {
    const out = 'You are logged in with grok.com.\n\nDefault model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n  - grok-4.5\n'
    expect(parseGrokModels(out)).toEqual({
      authStatus: 'authenticated',
      models: [
        { id: 'grok-4.7', name: 'grok-4.7', isDefault: true },
        { id: 'grok-4.5', name: 'grok-4.5', isDefault: false },
      ],
    })
  })

  test('reports unauthenticated', () => {
    const out = 'You are not authenticated.\n\nAvailable models:\n  * grok-4.6 (default)\n'
    expect(parseGrokModels(out).authStatus).toBe('unauthenticated')
  })

  test('unknown output yields unknown auth and no models', () => {
    expect(parseGrokModels('error: unexpected')).toEqual({ authStatus: 'unknown', models: [] })
  })
})
