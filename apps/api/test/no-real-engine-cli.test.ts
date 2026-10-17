import { describe, expect, test } from 'bun:test'
import { engineRegistry } from '@/engines/executors'
import { runCommand, spawnNode } from '@/engines/spawn'
/**
 * The test preload blocks engine CLIs. Tests that execute an issue on an
 * unmocked engine used to launch the real `claude` CLI in the repository,
 * holding process-manager slots and starting live agent sessions.
 */
import './setup'

const home = process.env.HOME ?? '/root'

describe('engine CLIs are blocked in tests', () => {
  test('spawnNode refuses engine binaries, by path or by name', () => {
    for (const argv of [
      [`${home}/.local/bin/claude`, '--version'],
      ['claude', '-p', '--', '/'],
      ['/usr/local/bin/codex', 'app-server'],
      ['grok', 'models'],
      ['cursor-agent', '--version'],
      ['npx', '-y', '@anthropic-ai/claude-code'],
    ]) {
      expect(() => spawnNode(argv)).toThrow('engine CLI blocked in tests')
    }
  })

  test('runCommand refuses engine binaries', async () => {
    await expect(runCommand(['claude', 'auth', 'status', '--json'])).rejects.toThrow('engine CLI blocked in tests')
  })

  test('other commands still run', async () => {
    const proc = spawnNode(['true'])
    expect(await proc.exited).toBe(0)
  })

  test('the claude-code executor reports itself unavailable instead of probing the CLI', async () => {
    const availability = await engineRegistry.get('claude-code')!.getAvailability()
    expect(availability.installed).toBe(false)
  })
})
