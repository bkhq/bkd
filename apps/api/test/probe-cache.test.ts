import { describe, expect, test } from 'bun:test'
import { getProbeResults, saveProbeResults, setAppSetting } from '@/db/helpers'
/**
 * Persisted engine probe cache (ENG-029).
 *
 * The DB copy is a cache, not storage: once it is older than the TTL it must
 * stop being served so a live probe can pick up a new CLI model catalog.
 */
import './setup'

const engines = [
  { engineType: 'codex' as const, installed: true, version: '0.144.3', authStatus: 'authenticated' as const },
]
const models = { codex: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', isDefault: true }] }

describe('probe result persistence', () => {
  test('returns freshly saved results', async () => {
    await saveProbeResults(engines, models)
    const result = await getProbeResults()
    expect(result).not.toBeNull()
    expect(result!.models.codex?.[0]?.id).toBe('gpt-5.6-sol')
  })

  test('returns null once the stored results are older than the TTL', async () => {
    await saveProbeResults(engines, models)
    // Backdate the stored timestamp beyond the TTL
    await setAppSetting('probe:updatedAt', String(Date.now() - 7 * 60 * 60 * 1000))
    expect(await getProbeResults()).toBeNull()
  })

  test('treats a missing timestamp (pre-upgrade rows) as expired', async () => {
    await saveProbeResults(engines, models)
    await setAppSetting('probe:updatedAt', '')
    expect(await getProbeResults()).toBeNull()
  })
})
