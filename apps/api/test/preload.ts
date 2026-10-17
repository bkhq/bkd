/**
 * Test preload — runs before any test file is loaded.
 * Sets up the test database path so all app modules use a test DB.
 */
import { mock } from 'bun:test'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { ROOT_DIR } from '@/root'

const testDir = resolve(ROOT_DIR, 'data/test')
const testDbPath = resolve(testDir, `test-${process.pid}-${Date.now()}.db`)

// Set DB_PATH before any app module is imported
process.env.DB_PATH = testDbPath
// Ensure no auth is needed
process.env.API_SECRET = ''
// Suppress engine startup probe logs during tests
process.env.NODE_ENV = 'test'

// Create test directory
if (!existsSync(testDir)) {
  mkdirSync(testDir, { recursive: true })
}
// Store path for cleanup
;(globalThis as any).__TEST_DB_PATH = testDbPath

// Block engine CLIs. Only codex is mocked below, so a test that executes an
// issue on another engine (e.g. the default claude-code) would otherwise launch
// the real CLI in the repository: a live agent session that holds a process
// slot and touches the user's OAuth credentials. Every executor, the startup
// probe and slash-command discovery spawn through these two helpers, so a
// blocked spawn fails like a missing binary does in CI.
const ENGINE_CLIS = new Set(['claude', 'codex', 'grok', 'cursor-agent', 'agent'])
const ENGINE_PACKAGES = ['@anthropic-ai/claude-code', '@openai/codex']

function assertNotEngineCli(argv: readonly string[]): void {
  const program = basename(argv[0] ?? '')
  if (ENGINE_CLIS.has(program) || argv.some(arg => ENGINE_PACKAGES.some(pkg => arg.startsWith(pkg)))) {
    throw new Error(`engine CLI blocked in tests: ${argv.join(' ')}`)
  }
}

// eslint-disable-next-line antfu/no-top-level-await
const realSpawn = await import('@/engines/spawn')
const { spawnNode, runCommand } = realSpawn
mock.module('@/engines/spawn', () => ({
  ...realSpawn,
  spawnNode: (argv: string[], ...rest: unknown[]) => {
    assertNotEngineCli(argv)
    return (spawnNode as (...args: unknown[]) => unknown)(argv, ...rest)
  },
  runCommand: async (argv: string[], ...rest: unknown[]) => {
    assertNotEngineCli(argv)
    return (runCommand as (...args: unknown[]) => unknown)(argv, ...rest)
  },
}))

// Override codex executor with mock for tests (no real subprocess)
// eslint-disable-next-line antfu/no-top-level-await
const { engineRegistry } = await import('@/engines/executors')
// eslint-disable-next-line antfu/no-top-level-await
const { MockCodexExecutor } = await import('./mock-codex-executor')
;(engineRegistry as any).register(new MockCodexExecutor())
