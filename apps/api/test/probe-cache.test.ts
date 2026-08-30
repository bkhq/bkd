import { describe, expect, test } from 'bun:test'
import { getProbeResults, saveProbeResults, setAppSetting } from '@/db/helpers'
/**
 * Persisted engine probe results (ENG-035, replacing the ENG-029 TTL).
 *
 * The DB copy is storage, not a cache: probing spawns the engine CLIs, and for
 * Claude that means `claude auth status`, which touches the rotating OAuth
 * credential. So stored results are served however old they are, and a re-probe
 * happens only on demand — first install, a vanished binary, or the operator
 * pressing "probe engines".
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

  test('keeps serving results however old they are', async () => {
    await saveProbeResults(engines, models)
    await setAppSetting('probe:updatedAt', String(Date.now() - 30 * 24 * 60 * 60 * 1000))

    const result = await getProbeResults()
    expect(result).not.toBeNull()
    expect(result!.models.codex?.[0]?.id).toBe('gpt-5.6-sol')
  })

  test('serves rows that carry no timestamp', async () => {
    await saveProbeResults(engines, models)
    await setAppSetting('probe:updatedAt', '')

    expect(await getProbeResults()).not.toBeNull()
  })

  test('returns null when nothing has been probed yet', async () => {
    await saveProbeResults(engines, models)
    await setAppSetting('probe:engines', '')

    expect(await getProbeResults()).toBeNull()
  })
})
