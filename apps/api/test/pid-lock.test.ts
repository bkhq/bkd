import { describe, expect, spyOn, test } from 'bun:test'
import { acquirePidLock, getProcessStartTime, isLockHolderAlive, releasePidLock } from '@/pid-lock'

/**
 * The lock holder is identified by the (pid, starttime) pair, so a recycled
 * PID is not mistaken for a live BKD instance.
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

describe('acquirePidLock', () => {
  test('a second call in the same process keeps the lock instead of exiting', () => {
    // `bun --hot` re-evaluates server-main.ts in the running process.
    const exit = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as typeof process.exit)
    const stderr = spyOn(console, 'error').mockImplementation(() => {})
    try {
      acquirePidLock()
      expect(() => acquirePidLock()).not.toThrow()
      expect(exit).not.toHaveBeenCalled()
    } finally {
      releasePidLock()
      exit.mockRestore()
      stderr.mockRestore()
    }
  })
})
