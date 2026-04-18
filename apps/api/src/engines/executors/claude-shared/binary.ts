import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveCommand } from '@/engines/spawn'
import type { EngineAvailability, EngineModel } from '@/engines/types'

/**
 * Find the `claude` binary in well-known locations WITHOUT falling back to npx.
 * Used for availability probing and SDK `pathToClaudeCodeExecutable`.
 */
export function resolveClaudeBinary(): string | null {
  if (existsSync('/work/bin/claude')) return '/work/bin/claude'
  const fromPath = resolveCommand('claude')
  if (fromPath) return fromPath
  const home = process.env.HOME ?? ''
  if (home) {
    const homeCandidates = [join(home, '.local/bin/claude'), join(home, '.bun/bin/claude')]
    const found = homeCandidates.find(p => existsSync(p))
    if (found) return found
  }
  if (existsSync('/usr/local/bin/claude')) return '/usr/local/bin/claude'
  return null
}

/**
 * Replicates the Agent SDK's internal fallback resolution for its bundled
 * `claude` binary: first the platform-specific optional packages
 * (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>[-musl]/claude`), then a
 * sibling `cli.js` next to the SDK entry point. Returned path — if any — is
 * safe to pass as `pathToClaudeCodeExecutable` and is also what the SDK itself
 * would spawn when the option is omitted.
 *
 * Separated from `resolveClaudeBinary()` so availability/discovery can report
 * "installed" in SDK-only deployments (no standalone global `claude` binary)
 * while still distinguishing externally-installed binaries for users who want
 * to pin a specific version.
 */
export function resolveSdkBundledClaudeBinary(): string | null {
  const platform = process.platform
  const arch = process.arch
  const exe = platform === 'win32' ? '.exe' : ''
  const candidates = platform === 'linux'
    ? [
        `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl/claude${exe}`,
        `@anthropic-ai/claude-agent-sdk-linux-${arch}/claude${exe}`,
      ]
    : [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude${exe}`]

  const req = createRequire(import.meta.url)
  for (const spec of candidates) {
    try {
      return req.resolve(spec)
    } catch {
      /* try next */
    }
  }

  try {
    const sdkPkg = req.resolve('@anthropic-ai/claude-agent-sdk/package.json')
    const sibling = join(dirname(sdkPkg), 'cli.js')
    if (existsSync(sibling)) return sibling
  } catch {
    /* SDK not resolvable — no fallback possible */
  }

  return null
}

/**
 * Unified resolution: prefer an externally-installed standalone `claude`
 * binary, then fall back to the SDK-bundled binary. Returns `null` only when
 * neither is resolvable, which means the SDK itself would also fail to spawn.
 */
export function resolveAnyClaudeBinary(): string | null {
  return resolveClaudeBinary() ?? resolveSdkBundledClaudeBinary()
}

export function getClaudeAuthStatus(): EngineAvailability['authStatus'] {
  if (process.env.ANTHROPIC_API_KEY) return 'authenticated'
  const home = process.env.HOME ?? '/root'
  if (existsSync(join(home, '.claude', '.credentials.json'))) return 'authenticated'
  return 'unauthenticated'
}

/**
 * Known Claude Code models — the CLI has no `models` subcommand, so we keep
 * a curated static list. `[1m]` variants use the 1M-token context window.
 */
export const CLAUDE_MODELS: EngineModel[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', isDefault: false },
  { id: 'claude-sonnet-4-6[1m]', name: 'Claude Sonnet 4.6 (1M)', isDefault: false },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', isDefault: true },
  { id: 'claude-opus-4-7[1m]', name: 'Claude Opus 4.7 (1M)', isDefault: false },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', isDefault: false },
  { id: 'claude-opus-4-6[1m]', name: 'Claude Opus 4.6 (1M)', isDefault: false },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', isDefault: false },
]
