/**
 * Webhook target URL validation.
 *
 * Local targets (loopback and private networks) are allowed, so a webhook can
 * reach a system on the same host or LAN. Link-local addresses — which include
 * the cloud metadata endpoint — and reserved ranges are blocked, both as IP
 * literals and when a hostname resolves to them.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// ── IP classification ──────────────────────────────────────

/** Returns true when `ip` falls in a private, loopback, link-local, or other reserved range. */
export function isPrivateIP(ip: string): boolean {
  const version = isIP(ip)

  if (version === 4) {
    const parts = ip.split('.').map(Number)
    const [a, b] = parts as [number, number, number, number]

    // 0.0.0.0/8 — current network
    if (a === 0) return true
    // 10.0.0.0/8
    if (a === 10) return true
    // 100.64.0.0/10 — shared address (CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true
    // 127.0.0.0/8 — loopback
    if (a === 127) return true
    // 169.254.0.0/16 — link-local
    if (a === 169 && b === 254) return true
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.0.0.0/24 — IETF protocol assignments
    if (a === 192 && b === 0 && parts[2] === 0) return true
    // 192.0.2.0/24 — TEST-NET-1
    if (a === 192 && b === 0 && parts[2] === 2) return true
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true
    // 198.18.0.0/15 — benchmarking
    if (a === 198 && (b === 18 || b === 19)) return true
    // 198.51.100.0/24 — TEST-NET-2
    if (a === 198 && b === 51 && parts[2] === 100) return true
    // 203.0.113.0/24 — TEST-NET-3
    if (a === 203 && b === 0 && parts[2] === 113) return true
    // 224.0.0.0/4 — multicast
    if (a >= 224 && a <= 239) return true
    // 240.0.0.0/4 — reserved / broadcast
    if (a >= 240) return true

    return false
  }

  if (version === 6) {
    const lower = ip.toLowerCase()
    // Unspecified (::)
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true
    // Loopback (::1)
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
    // IPv4-mapped (::ffff:x.x.x.x) — delegate to IPv4 check
    const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (v4Mapped) return isPrivateIP(v4Mapped[1]!)
    // Link-local (fe80::/10)
    if (/^fe[89ab]/i.test(lower)) return true
    // Unique local (fc00::/7)
    if (/^f[cd]/i.test(lower)) return true
    // Multicast (ff00::/8)
    if (lower.startsWith('ff')) return true
    // Discard (100::/64)
    if (lower.startsWith('100:')) return true

    return false
  }

  // Not a valid IP — treat as private to be safe
  return true
}

/** Returns true for loopback and private-network addresses, which a webhook may target. */
function isLocalIP(ip: string): boolean {
  const version = isIP(ip)

  if (version === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number]
    // 127.0.0.0/8 — loopback
    if (a === 127) return true
    // 10.0.0.0/8
    if (a === 10) return true
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true
    // 100.64.0.0/10 — shared address (CGNAT, tailnets)
    if (a === 100 && b >= 64 && b <= 127) return true
    return false
  }

  if (version === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
    const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (v4Mapped) return isLocalIP(v4Mapped[1]!)
    // Unique local (fc00::/7)
    return /^f[cd]/.test(lower)
  }

  return false
}

/** Returns true when a webhook must not target `ip`: link-local, multicast, unspecified or reserved. */
export function isBlockedIP(ip: string): boolean {
  return isPrivateIP(ip) && !isLocalIP(ip)
}

/** The IP literal a URL hostname holds (IPv6 comes bracketed), or null for a DNS name. */
function ipLiteral(hostname: string): string | null {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return isIP(bare) ? bare : null
}

const BLOCKED_ERROR = 'URLs pointing to link-local or reserved addresses are not allowed'

// ── DNS-resolving validation ───────────────────────────────

export interface UrlValidationResult {
  ok: boolean
  error?: string
}

/** Signature for the DNS resolver function used by validateWebhookUrl. */
export type DnsResolver = (hostname: string) => Promise<{ address: string, family: number }[]>

/** Default resolver using node:dns/promises. */
const defaultResolver: DnsResolver = async (hostname) => {
  return lookup(hostname, { all: true })
}

/**
 * Validates a webhook URL:
 * 1. Parses it and checks protocol (http/https only).
 * 2. Rejects blocked IP literals.
 * 3. Resolves DNS and rejects if *any* resulting address is blocked.
 *
 * @param url — the webhook target URL to validate.
 * @param resolver — optional DNS resolver, defaults to node:dns/promises lookup.
 *   Exposed for testing without monkey-patching built-in modules.
 */
export async function validateWebhookUrl(
  url: string,
  resolver: DnsResolver = defaultResolver,
): Promise<UrlValidationResult> {
  const storageCheck = validateWebhookUrlForStorage(url)
  if (!storageCheck.ok) return storageCheck

  const parsed = new URL(url)
  const hostname = parsed.hostname.toLowerCase()

  // An IP literal was already checked; skip DNS
  if (ipLiteral(hostname)) {
    return { ok: true }
  }

  // Resolve DNS and verify no address is blocked
  try {
    const addresses = await resolver(hostname)
    if (addresses.length === 0) {
      return { ok: false, error: 'Hostname does not resolve to any address' }
    }
    for (const entry of addresses) {
      if (isBlockedIP(entry.address)) {
        return { ok: false, error: BLOCKED_ERROR }
      }
    }
  } catch {
    return { ok: false, error: 'Failed to resolve hostname' }
  }

  return { ok: true }
}

/**
 * Validates a webhook URL before storing it.
 *
 * This intentionally does not resolve DNS. Saving a webhook does not perform a
 * delivery, and unresolved hostnames may become valid later. Delivery-time
 * validation must still call `validateWebhookUrl()` to block hostnames that
 * resolve to a blocked address before any outbound request is made.
 */
export function validateWebhookUrlForStorage(url: string): UrlValidationResult {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Invalid URL format' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'URL must use http or https protocol' }
  }

  const literal = ipLiteral(parsed.hostname.toLowerCase())
  if (literal && isBlockedIP(literal)) {
    return { ok: false, error: BLOCKED_ERROR }
  }

  return { ok: true }
}
