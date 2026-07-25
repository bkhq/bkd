import type { ClaudeUsage, ClaudeUsageModelWindow, ClaudeUsageWindow } from '@bkd/shared'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '@/logger'

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

function credentialsPath(): string {
  const home = process.env.HOME ?? '/root'
  return join(home, '.claude', '.credentials.json')
}

/** Read the OAuth access token from the local Claude credentials file. */
async function readAccessToken(): Promise<string | null> {
  const path = credentialsPath()
  if (!existsSync(path)) return null
  try {
    const raw = await Bun.file(path).json()
    const token = raw?.claudeAiOauth?.accessToken
    return typeof token === 'string' && token.length > 0 ? token : null
  } catch (error) {
    logger.warn({ error }, 'claude_usage_read_credentials_failed')
    return null
  }
}

function parseWindow(raw: unknown): ClaudeUsageWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  const pct = typeof w.utilization === 'number' ? w.utilization : null
  if (pct === null) return null
  return {
    usedPercentage: pct,
    resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null,
  }
}

/**
 * Extract model-scoped weekly windows (e.g. Fable) from the upstream `limits`
 * array. Malformed entries are dropped; never throws.
 */
export function parseModelWindows(raw: unknown): ClaudeUsageModelWindow[] {
  if (!Array.isArray(raw)) return []
  const windows: ClaudeUsageModelWindow[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const l = entry as Record<string, unknown>
    if (l.kind !== 'weekly_scoped') continue
    const scope = l.scope as Record<string, unknown> | null | undefined
    const model = (scope?.model as Record<string, unknown> | null | undefined)?.display_name
    if (typeof model !== 'string' || model.length === 0) continue
    if (typeof l.percent !== 'number') continue
    windows.push({
      model,
      usedPercentage: l.percent,
      resetsAt: typeof l.resets_at === 'string' ? l.resets_at : null,
    })
  }
  return windows
}

/**
 * Fetch Claude subscription rate-limit utilization (the TUI `/usage` panel).
 * Proxies the undocumented `GET /api/oauth/usage` endpoint using the local
 * OAuth token. The token is never returned, logged, or stored. Returns a
 * normalized envelope with graceful unavailable states.
 */
export async function getClaudeUsage(): Promise<ClaudeUsage> {
  const token = await readAccessToken()
  if (!token) {
    return {
      available: false,
      reason: process.env.ANTHROPIC_API_KEY ? 'api_key_mode' : 'no_credentials',
    }
  }

  let res: Response
  try {
    res = await fetch(USAGE_ENDPOINT, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
      },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    logger.warn({ error }, 'claude_usage_fetch_failed')
    return { available: false, reason: 'upstream_error' }
  }

  if (res.status === 401 || res.status === 403) {
    return { available: false, reason: 'token_expired' }
  }
  if (!res.ok) {
    logger.warn({ status: res.status }, 'claude_usage_upstream_error')
    return { available: false, reason: 'upstream_error' }
  }

  try {
    const json = (await res.json()) as Record<string, unknown>
    return {
      available: true,
      fiveHour: parseWindow(json.five_hour),
      sevenDay: parseWindow(json.seven_day),
      modelWindows: parseModelWindows(json.limits),
    }
  } catch (error) {
    logger.warn({ error }, 'claude_usage_parse_failed')
    return { available: false, reason: 'upstream_error' }
  }
}
