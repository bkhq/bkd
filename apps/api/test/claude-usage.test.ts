import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getClaudeUsage, parseModelWindows } from '@/engines/executors/claude/usage'

/**
 * Offline degradation tests for the Claude usage proxy. Points HOME at an empty
 * temp dir so no real credentials are read and no network call is made.
 */
describe('getClaudeUsage (offline degradation)', () => {
  let tmpHome: string
  let prevHome: string | undefined
  let prevApiKey: string | undefined

  beforeEach(() => {
    prevHome = process.env.HOME
    prevApiKey = process.env.ANTHROPIC_API_KEY
    tmpHome = mkdtempSync(join(tmpdir(), 'bkd-usage-'))
    process.env.HOME = tmpHome
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prevApiKey
    rmSync(tmpHome, { recursive: true, force: true })
  })

  test('no credentials and no API key → no_credentials', async () => {
    const usage = await getClaudeUsage()
    expect(usage.available).toBe(false)
    expect(usage.reason).toBe('no_credentials')
  })

  test('no credentials but API key present → api_key_mode', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    const usage = await getClaudeUsage()
    expect(usage.available).toBe(false)
    expect(usage.reason).toBe('api_key_mode')
  })
})

describe('parseModelWindows', () => {
  // Shape observed in a live probe of GET /api/oauth/usage (2026-07-17)
  const limits = [
    { kind: 'session', group: 'session', percent: 6, severity: 'normal', resets_at: '2026-07-17T15:00:00Z', scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 19, severity: 'normal', resets_at: '2026-07-20T00:00:00Z', scope: null, is_active: true },
    { kind: 'weekly_scoped', group: 'weekly', percent: 17, severity: 'normal', resets_at: '2026-07-20T00:00:00Z', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
  ]

  test('extracts model-scoped weekly windows only', () => {
    expect(parseModelWindows(limits)).toEqual([
      { model: 'Fable', usedPercentage: 17, resetsAt: '2026-07-20T00:00:00Z' },
    ])
  })

  test('drops malformed entries and tolerates non-array input', () => {
    expect(parseModelWindows(undefined)).toEqual([])
    expect(parseModelWindows('nope')).toEqual([])
    expect(parseModelWindows([
      null,
      { kind: 'weekly_scoped', percent: 10, scope: null },
      { kind: 'weekly_scoped', percent: 'high', scope: { model: { display_name: 'Fable' } } },
      { kind: 'weekly_scoped', percent: 10, resets_at: 42, scope: { model: { display_name: 'Opus' } } },
    ])).toEqual([
      { model: 'Opus', usedPercentage: 10, resetsAt: null },
    ])
  })
})
