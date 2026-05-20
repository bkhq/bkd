import { UPGRADE_DRAINING_CODE } from '@bkd/shared'
import { afterAll, describe, expect, it } from 'bun:test'
import { ensureWorking } from '../src/routes/issues/_shared'
import { drainRunningIssues, isDraining, setDraining } from '../src/upgrade/drain'

describe('upgrade drain', () => {
  it('starts not draining', () => {
    setDraining(false)
    expect(isDraining()).toBe(false)
  })

  it('setDraining toggles the flag', () => {
    setDraining(true)
    expect(isDraining()).toBe(true)
    setDraining(false)
    expect(isDraining()).toBe(false)
  })

  it('drains immediately when no engine processes are active', async () => {
    setDraining(false)
    const result = await drainRunningIssues(5_000)
    expect(result.drained).toBe(true)
    expect(result.remaining).toEqual([])
    // Drain leaves the flag set so new runs stay rejected until shutdown.
    expect(isDraining()).toBe(true)
    setDraining(false)
  })
})

describe('ensureWorking during drain', () => {
  afterAll(() => setDraining(false))

  // ensureWorking returns early on the draining check, before touching the
  // issue row, so a minimal cast is enough for this branch.
  const fakeIssue = { id: 'i1', projectId: 'p1', statusId: 'working' } as Parameters<
    typeof ensureWorking
  >[0]

  it('rejects with the UPGRADE_DRAINING code while draining', async () => {
    setDraining(true)
    const result = await ensureWorking(fakeIssue)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe(UPGRADE_DRAINING_CODE)
  })

  it('allows a working issue once draining clears', async () => {
    setDraining(false)
    const result = await ensureWorking(fakeIssue)
    expect(result.ok).toBe(true)
  })
})
