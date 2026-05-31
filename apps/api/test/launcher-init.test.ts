import { describe, expect, it } from 'bun:test'

describe('launcher-init exports', () => {
  it('exports initLauncher function', async () => {
    const mod = await import('@/launcher-init')
    expect(typeof mod.initLauncher).toBe('function')
  })

  it('exports registerUpgradeShutdown function', async () => {
    const mod = await import('@/launcher-init')
    expect(typeof mod.registerUpgradeShutdown).toBe('function')
  })
})
