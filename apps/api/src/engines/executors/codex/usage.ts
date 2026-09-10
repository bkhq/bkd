import type { CodexUsage, CodexUsageWindow } from '@bkd/shared'
import { safeEnv } from '@/engines/safe-env'
import { spawnNode } from '@/engines/spawn'
import { logger } from '@/logger'
import { JSONRPC_TIMEOUT, JsonRpcSession, resolveBinaryOnly } from './executor'
import { INITIALIZE_CAPABILITIES } from './protocol'

interface CodexRateLimits {
  primary: CodexUsageWindow | null
  secondary: CodexUsageWindow | null
  planType: string | null
}

const EMPTY_RATE_LIMITS: CodexRateLimits = { primary: null, secondary: null, planType: null }

/** First finite number among the candidates, or null. */
function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/** Convert a unix timestamp in seconds to an ISO string. */
function toIso(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseWindow(raw: unknown): CodexUsageWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  const usedPercentage = firstNumber(w.usedPercent, w.used_percent)
  if (usedPercentage === null) return null
  return {
    usedPercentage,
    windowMinutes: firstNumber(w.windowDurationMins, w.window_minutes),
    resetsAt: toIso(firstNumber(w.resetsAt, w.resets_at)),
  }
}

/**
 * Extract the rate-limit windows from a Codex `RateLimitSnapshot`. The
 * app-server reports camelCase, the CLI's session rollouts snake_case; both
 * are accepted. Malformed entries are dropped; never throws.
 */
export function parseRateLimits(raw: unknown): CodexRateLimits {
  if (!raw || typeof raw !== 'object') return EMPTY_RATE_LIMITS
  const snapshot = raw as Record<string, unknown>
  const planType = snapshot.planType ?? snapshot.plan_type
  return {
    primary: parseWindow(snapshot.primary),
    secondary: parseWindow(snapshot.secondary),
    planType: typeof planType === 'string' ? planType : null,
  }
}

/**
 * Fetch Codex subscription rate-limit utilization (the TUI `/status` panel).
 * Starts a short-lived app-server and calls `account/rateLimits/read`, so the
 * OAuth token stays inside the Codex CLI. Returns a normalized envelope with
 * graceful unavailable states.
 */
export async function getCodexUsage(): Promise<CodexUsage> {
  const binaryPath = resolveBinaryOnly()
  if (!binaryPath) return { available: false, reason: 'not_installed' }

  const proc = spawnNode([binaryPath, 'app-server'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: safeEnv({ NPM_CONFIG_LOGLEVEL: 'error' }, 'codex'),
    detached: false,
  })

  // Drain stderr to prevent the pipe from filling up and blocking the process
  const stderrReader = new Response(proc.stderr).text()

  const killTimer = setTimeout(() => proc.kill(), JSONRPC_TIMEOUT + 5000)
  const session = new JsonRpcSession(proc)

  try {
    await session.call(
      'initialize',
      {
        clientInfo: { name: 'bkd', title: 'BKD', version: '0.1.0' },
        capabilities: INITIALIZE_CAPABILITIES,
      },
      0,
    )
    session.notify('initialized', {})

    const account = (await session.call('account/read', {}, 1)) as Record<string, unknown>
    const requiresAuth = account?.requiresOpenaiAuth ?? account?.requires_openai_auth
    if (requiresAuth && !account?.account) {
      return { available: false, reason: 'unauthenticated' }
    }

    const result = (await session.call('account/rateLimits/read', {}, 2)) as Record<string, unknown>
    const { primary, secondary, planType } = parseRateLimits(result?.rateLimits ?? result?.rate_limits)
    return { available: true, primary, secondary, planType }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stderr = await stderrReader.catch(() => '')
    logger.warn({ error: message, stderr: stderr.slice(0, 500) }, 'codex_usage_failed')
    if (/method not found|not supported|unknown method/i.test(message)) {
      return { available: false, reason: 'unsupported' }
    }
    return { available: false, reason: 'upstream_error' }
  } finally {
    session.destroy()
    clearTimeout(killTimer)
    proc.kill()
  }
}
