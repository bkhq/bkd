import { UPGRADE_DRAINING_CODE } from '@bkd/shared'
import { afterEach, describe, expect, it } from 'bun:test'
import { issueEngine } from '../src/engines/issue'
import { ensureWorking } from '../src/routes/issues/_shared'
import { drainRunningIssues, isDraining, setDraining } from '../src/upgrade/drain'

// The draining flag is process-global. Always clear it after every test —
// even on assertion failure — so a stuck flag can't leak into other test
// files and make their execute/follow-up calls hang.
afterEach(() => setDraining(false))

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

  it('drainRunningIssues sets the flag and reports completion consistent with engine state', async () => {
    setDraining(false)
    const result = await drainRunningIssues(2_000)
    // Whether the drain "completes" depends on whether the shared issueEngine
    // singleton has active processes — assert the result is self-consistent
    // rather than pinning it to a value that other test files can disturb.
    const idle = issueEngine.getActiveProcesses().length === 0
    expect(result.drained).toBe(idle)
    if (idle) expect(result.remaining).toEqual([])
    // Drain leaves the flag set so new runs stay rejected until shutdown.
    expect(isDraining()).toBe(true)
  })
})

describe('ensureWorking during drain', () => {
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
