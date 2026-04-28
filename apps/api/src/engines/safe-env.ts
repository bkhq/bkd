import process from 'node:process'
import { logger } from '@/logger'

import type { EngineType } from './types'

// In-memory cache for global env vars — sync access for safeEnv(), async refresh.
let _globalEnvCache: Record<string, string> = {}
let _globalEnvCacheAt = 0
const CACHE_TTL_MS = 30_000 // 30s

/** Refresh global env vars cache from DB (call on startup + after settings change). */
export async function refreshGlobalEnvCache(): Promise<void> {
  try {
    const { getAppSetting } = await import('@/db/helpers')
    const raw = await getAppSetting('engine:globalEnvVars')
    _globalEnvCache = raw ? JSON.parse(raw) as Record<string, string> : {}
  } catch {
    _globalEnvCache = {}
  }
  _globalEnvCacheAt = Date.now()
}

/** Get cached global env vars (sync). Returns empty object if cache cold. */
export function getCachedGlobalEnvVars(): Record<string, string> {
  // Trigger async refresh if stale (non-blocking)
  if (Date.now() - _globalEnvCacheAt > CACHE_TTL_MS) {
    void refreshGlobalEnvCache()
  }
  return _globalEnvCache
}

/**
 * Keys that user-provided envVars (from project settings) must never override.
 * These control security-critical paths and authentication credentials.
 */
const PROTECTED_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'IS_SANDBOX',
  'NODE_ENV',
  'BUN_ENV',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
])

/**
 * Map engine types to the API key(s) they actually need.
 * Keys not in the engine's set are excluded from the environment.
 */
const ENGINE_API_KEYS: Record<string, string[]> = {
  'claude-code': ['ANTHROPIC_API_KEY'],
  'claude-code-sdk': ['ANTHROPIC_API_KEY'],
  'codex': ['OPENAI_API_KEY', 'CODEX_API_KEY'],
}

const ALL_API_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
])

/**
 * Allowlist of environment variables safe to pass to child engine processes.
 * Prevents leaking secrets like DB_PATH, API_SECRET, or other sensitive vars.
 */
const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'TERM',
  'NPM_CONFIG_LOGLEVEL',
  // Engine-specific auth — filtered per engine by safeEnv()
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  // Sandbox flag (allows --dangerously-skip-permissions as root)
  'IS_SANDBOX',
  // Commonly needed
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
]

/**
 * Build an env object containing only allowlisted vars from process.env,
 * merged with global env vars (from app settings) and any extra vars from the caller.
 *
 * Priority (highest wins): project envVars (extra) > global envVars > process.env allowlist.
 * Protected keys (PATH, HOME, API keys, etc.) cannot be overridden by user-supplied vars.
 */
export function safeEnv(
  extra?: Record<string, string>,
  engineType?: EngineType,
): Record<string, string> {
  // Determine which API keys to include based on engine type
  const allowedApiKeys = engineType
    ? new Set(ENGINE_API_KEYS[engineType] ?? [])
    : ALL_API_KEYS // no engine specified → include all (backward compat for probes etc.)

  const env: Record<string, string> = {
    IS_SANDBOX: '1',
  }
  for (const key of SAFE_ENV_KEYS) {
    // Skip API keys not relevant to this engine
    if (ALL_API_KEYS.has(key) && !allowedApiKeys.has(key)) {
      continue
    }
    if (process.env[key]) {
      env[key] = process.env[key]!
    }
  }

  // Merge global env vars (from app settings cache)
  const globalVars = getCachedGlobalEnvVars()
  if (globalVars) {
    for (const [key, value] of Object.entries(globalVars)) {
      if (PROTECTED_KEYS.has(key)) {
        logger.warn({ key }, 'env_override_blocked: global envVar tried to override a protected key')
        continue
      }
      env[key] = value
    }
  }

  // Merge project-level env vars (highest priority)
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (PROTECTED_KEYS.has(key)) {
        logger.warn({ key }, 'env_override_blocked: user-supplied envVar tried to override a protected key')
        continue
      }
      env[key] = value
    }
  }

  return env
}
