import { describe, expect, test } from 'bun:test'
import { parseClaudeAuthStatus } from '@/engines/executors/claude'
/**
 * Engine availability detection (ENG-030).
 *
 * Auth status comes from `claude auth status --json`, which is the only
 * cross-platform source: on macOS the credentials live in the login Keychain,
 * not in ~/.claude/.credentials.json.
 */
import { probeBinariesMissing } from '@/engines/startup-probe'
import './setup'

describe('parseClaudeAuthStatus', () => {
  test('maps loggedIn: true to authenticated', () => {
    const json = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max',
    })
    expect(parseClaudeAuthStatus(json)).toBe('authenticated')
  })

  test('maps loggedIn: false to unauthenticated', () => {
    expect(parseClaudeAuthStatus('{"loggedIn": false}')).toBe('unauthenticated')
  })

  test('tolerates surrounding noise from the CLI', () => {
    expect(parseClaudeAuthStatus('warning: update available\n{"loggedIn": true}\n')).toBe(
      'authenticated',
    )
  })

  test('returns null when the payload has no loggedIn flag', () => {
    expect(parseClaudeAuthStatus('{"status": "ok"}')).toBeNull()
  })

  test('returns null for non-JSON output (older CLI without the subcommand)', () => {
    expect(parseClaudeAuthStatus('error: unknown command "auth"')).toBeNull()
    expect(parseClaudeAuthStatus('')).toBeNull()
  })
})

describe('probeBinariesMissing', () => {
  const base = { engineType: 'claude-code' as const, authStatus: 'authenticated' as const }

  test('is false when the recorded binary still exists', () => {
    expect(
      probeBinariesMissing([{ ...base, installed: true, binaryPath: process.execPath }]),
    ).toBe(false)
  })

  test('is true when the recorded binary is gone', () => {
    expect(
      probeBinariesMissing([{ ...base, installed: true, binaryPath: '/work/bin/does-not-exist' }]),
    ).toBe(true)
  })

  test('ignores engines that are not installed or have no path', () => {
    expect(
      probeBinariesMissing([
        { ...base, installed: false, binaryPath: '/work/bin/does-not-exist' },
        { ...base, installed: true },
      ]),
    ).toBe(false)
  })
})
