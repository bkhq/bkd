import { describe, expect, test } from 'bun:test'
import { getProcessStartTime, isLockHolderAlive } from '@/pid-lock'

/**
 * Guards ENG-017: the lock holder is identified by the (pid, starttime) pair so
 * a recycled PID is not mistaken for a live BKD instance (which previously
 * blocked startup with a false "another instance running").
 */
describe('pid-lock holder detection', () => {
  test('getProcessStartTime returns a numeric tick for the current process', () => {
    const st = getProcessStartTime(process.pid)
    expect(st).toBeDefined()
    expect(/^\d+$/.test(st!)).toBe(true)
  })

  test('same pid + matching start time is held', () => {
    const st = getProcessStartTime(process.pid)!
    expect(isLockHolderAlive(`${process.pid}:${st}`)).toBe(true)
  })

  test('reused pid (start-time mismatch) is treated as stale', () => {
    // process.pid is alive, but start time "1" can never match → recycled PID.
    expect(isLockHolderAlive(`${process.pid}:1`)).toBe(false)
  })

  test('dead pid is stale', () => {
    // A reaped child PID is no longer alive (until eventually recycled).
    const child = Bun.spawnSync(['true'])
    expect(isLockHolderAlive(`${child.pid}:123`)).toBe(false)
  })

  test('garbage content is stale', () => {
    expect(isLockHolderAlive('')).toBe(false)
    expect(isLockHolderAlive('not-a-pid')).toBe(false)
  })

  test('a legacy lock (no start time) for a live process is conservatively held', () => {
    // No start time to compare → cannot detect reuse → must NOT be treated as
    // stale (deleting it would allow a concurrent second instance at startup).
    expect(isLockHolderAlive(String(process.pid))).toBe(true)
  })
})
