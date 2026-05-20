import { describe, expect, it } from 'bun:test'
import { applyLocalVersion, listLocalAppVersions } from '@/upgrade/apply'
import { isPackageMode } from '@/upgrade/constants'

// The test runner is not a compiled package build, so isPackageMode is false.
// These tests pin the package-mode guard — the success path (which calls
// process.exit) is intentionally not exercised here.
describe('local package apply (non-package mode)', () => {
  it('test environment is not package mode', () => {
    expect(isPackageMode).toBe(false)
  })

  it('listLocalAppVersions returns empty outside package mode', () => {
    expect(listLocalAppVersions()).toEqual([])
  })

  it('applyLocalVersion is rejected outside package mode', async () => {
    await expect(applyLocalVersion('1.2.3')).rejects.toThrow(
      'Local version apply is only available in package mode',
    )
  })
})
