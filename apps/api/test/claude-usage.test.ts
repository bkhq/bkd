import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getClaudeUsage } from '@/engines/executors/claude/usage'

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
