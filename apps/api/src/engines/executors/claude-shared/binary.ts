import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
