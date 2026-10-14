/**
 * Tests for SSRF-safe URL validation (utils/url-safety.ts).
 *
 * Validates that:
 * - Private/reserved IPs are correctly classified
 * - Local targets (loopback, private networks) are allowed
 * - Link-local and reserved targets are blocked, as literals and through DNS
 */
import type { DnsResolver } from '@/utils/url-safety'
import { describe, expect, test } from 'bun:test'
import { isBlockedIP, isPrivateIP, validateWebhookUrl, validateWebhookUrlForStorage } from '@/utils/url-safety'

// ── Fake resolvers ─────────────────────────────────────────

function fakeResolver(addresses: { address: string, family: number }[]): DnsResolver {
  return async () => addresses
}

function failingResolver(message = 'ENOTFOUND'): DnsResolver {
  return async () => {
    throw new Error(message)
  }
}

// ── isPrivateIP ────────────────────────────────────────────

describe('isPrivateIP', () => {
  const privateCases = [
    // Loopback
    '127.0.0.1',
    '127.255.255.255',
    // 10.x.x.x
    '10.0.0.1',
    '10.255.255.255',
    // 172.16-31.x.x
    '172.16.0.1',
    '172.31.255.255',
    // 192.168.x.x
    '192.168.0.1',
    '192.168.255.255',
    // Link-local
    '169.254.0.1',
    '169.254.169.254', // cloud metadata
    // CGNAT
    '100.64.0.1',
    '100.127.255.255',
    // Current network
    '0.0.0.0',
    '0.255.255.255',
    // Multicast
    '224.0.0.1',
    '239.255.255.255',
    // Reserved
    '240.0.0.1',
    '255.255.255.255',
    // TEST-NETs
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    // Benchmarking
    '198.18.0.1',
    // IPv6 loopback
    '::1',
    // IPv6 link-local
    'fe80::1',
    // IPv6 unique local
    'fc00::1',
    'fd12::1',
    // IPv6 multicast
    'ff02::1',
  ]

  for (const ip of privateCases) {
    test(`${ip} → private`, () => {
      expect(isPrivateIP(ip)).toBe(true)
    })
  }

  const publicCases = [
    '8.8.8.8',
    '1.1.1.1',
    '142.250.80.46', // google.com
    '104.21.0.1',
    '2606:4700::1', // Cloudflare IPv6
  ]

  for (const ip of publicCases) {
    test(`${ip} → public`, () => {
      expect(isPrivateIP(ip)).toBe(false)
    })
  }

  test('IPv4-mapped IPv6 delegates correctly', () => {
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false)
  })

  test('invalid string treated as private', () => {
    expect(isPrivateIP('not-an-ip')).toBe(true)
  })
})

// ── isBlockedIP ────────────────────────────────────────────

describe('isBlockedIP', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd12:3456::1', '::ffff:127.0.0.1', '8.8.8.8']) {
    test(`${ip} → allowed`, () => {
      expect(isBlockedIP(ip)).toBe(false)
    })
  }

  for (const ip of ['169.254.169.254', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.1', 'fe80::1', '::', 'ff02::1', '::ffff:169.254.169.254', 'not-an-ip']) {
    test(`${ip} → blocked`, () => {
      expect(isBlockedIP(ip)).toBe(true)
    })
  }
})

// ── validateWebhookUrl ─────────────────────────────────────

describe('validateWebhookUrl', () => {
  test('rejects non-http protocols', async () => {
    const result = await validateWebhookUrl('ftp://example.com/hook')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('http or https')
  })

  test('rejects malformed URLs', async () => {
    const result = await validateWebhookUrl('not a url')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid URL')
  })

  for (const url of ['http://127.0.0.1/hook', 'http://10.0.0.5/hook', 'http://192.168.1.100/hook', 'http://[::1]:8080/hook']) {
    test(`accepts local IP literal ${url}`, async () => {
      expect((await validateWebhookUrl(url, failingResolver())).ok).toBe(true)
    })
  }

  test('accepts localhost', async () => {
    const resolver = fakeResolver([{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }])
    expect((await validateWebhookUrl('http://localhost:8080/hook', resolver)).ok).toBe(true)
  })

  test('rejects 169.254.169.254 (cloud metadata)', async () => {
    const result = await validateWebhookUrl('http://169.254.169.254/latest/meta-data/')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('link-local')
  })

  test('rejects a link-local IPv6 literal', async () => {
    expect((await validateWebhookUrl('http://[fe80::1]/hook')).ok).toBe(false)
  })

  test('accepts public IP literal', async () => {
    const result = await validateWebhookUrl('https://8.8.8.8/hook')
    expect(result.ok).toBe(true)
  })

  // ── DNS scenarios (using injectable resolver) ──

  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '100.100.1.1']) {
    test(`accepts hostname resolving to local address ${address}`, async () => {
      const resolver = fakeResolver([{ address, family: 4 }])
      expect((await validateWebhookUrl('https://bridge.internal.example.com/hook', resolver)).ok).toBe(true)
    })
  }

  test('accepts hostname resolving to IPv6 unique-local', async () => {
    const resolver = fakeResolver([{ address: 'fd12:3456::1', family: 6 }])
    expect((await validateWebhookUrl('https://ula.example.com/hook', resolver)).ok).toBe(true)
  })

  test('rejects hostname resolving to metadata IP via DNS', async () => {
    const resolver = fakeResolver([{ address: '169.254.169.254', family: 4 }])
    const result = await validateWebhookUrl('https://metadata-rebind.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('link-local')
  })

  test('rejects if any resolved address is blocked (mixed results)', async () => {
    const resolver = fakeResolver([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    const result = await validateWebhookUrl('https://dual-record.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('link-local')
  })

  test('rejects hostname resolving to link-local IPv6', async () => {
    const resolver = fakeResolver([{ address: 'fe80::1', family: 6 }])
    const result = await validateWebhookUrl('https://ipv6-rebind.example.com/hook', resolver)
    expect(result.ok).toBe(false)
  })

  test('accepts hostname resolving to public IP', async () => {
    const resolver = fakeResolver([{ address: '93.184.216.34', family: 4 }])
    const result = await validateWebhookUrl('https://example.com/hook', resolver)
    expect(result.ok).toBe(true)
  })

  test('accepts hostname resolving to multiple public IPs', async () => {
    const resolver = fakeResolver([
      { address: '93.184.216.34', family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])
    const result = await validateWebhookUrl('https://cdn.example.com/hook', resolver)
    expect(result.ok).toBe(true)
  })

  test('rejects hostname that fails DNS resolution', async () => {
    const resolver = failingResolver('ENOTFOUND')
    const result = await validateWebhookUrl('https://nonexistent.invalid/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('resolve')
  })

  test('rejects hostname that returns empty addresses', async () => {
    const resolver = fakeResolver([])
    const result = await validateWebhookUrl('https://empty.example.com/hook', resolver)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('resolve')
  })
})

// ── validateWebhookUrlForStorage ───────────────────────────

describe('validateWebhookUrlForStorage', () => {
  test('accepts unresolved hostnames without DNS lookup', () => {
    const result = validateWebhookUrlForStorage('https://not-yet-created.invalid/hook')
    expect(result.ok).toBe(true)
  })

  test('rejects malformed URLs', () => {
    const result = validateWebhookUrlForStorage('not a url')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid URL')
  })

  test('rejects non-http protocols', () => {
    const result = validateWebhookUrlForStorage('ftp://example.com/hook')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('http or https')
  })

  test('accepts local hostnames and IP literals', () => {
    expect(validateWebhookUrlForStorage('http://localhost:3000/hook').ok).toBe(true)
    expect(validateWebhookUrlForStorage('http://127.0.0.1/hook').ok).toBe(true)
    expect(validateWebhookUrlForStorage('http://10.0.0.5/hook').ok).toBe(true)
    expect(validateWebhookUrlForStorage('http://[::1]/hook').ok).toBe(true)
  })

  test('rejects link-local and reserved IP literals', () => {
    expect(validateWebhookUrlForStorage('http://169.254.169.254/latest').ok).toBe(false)
    expect(validateWebhookUrlForStorage('http://0.0.0.0/hook').ok).toBe(false)
    expect(validateWebhookUrlForStorage('http://[fe80::1]/hook').ok).toBe(false)
  })
})
