import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { AcpProtocolHandler } from '@/engines/executors/acp/protocol-handler'

describe('AcpProtocolHandler heartbeat', () => {
  let activityCalls: number

  beforeEach(() => {
    activityCalls = 0
  })

  test('fires onActivity every 30 seconds while alive', async () => {
    // Use a real child process (echo) so ndJsonStream gets valid streams.
    const child = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] })

    const handler = new AcpProtocolHandler(child, 'auto')
    handler.onActivity = () => {
      activityCalls++
    }

    // Wait for 2 heartbeat intervals (30s each) — too slow for tests.
    // Instead, monkey-patch the timer to fire immediately.
    const origInterval = (handler as any).heartbeatTimer
    clearInterval(origInterval)

    let tick: (() => void) | undefined
    const mockSetInterval = mock((fn: () => void, _ms: number) => {
      tick = fn
      return 99 as unknown as ReturnType<typeof setInterval>
    })
    const mockClearInterval = mock(() => {})

    const origSetInterval = globalThis.setInterval
    const origClearInterval = globalThis.clearInterval

    try {
      globalThis.setInterval = mockSetInterval as any
      globalThis.clearInterval = mockClearInterval as any

      // Force re-creation of the timer by creating a new handler
      const child2 = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] })
      const h2 = new AcpProtocolHandler(child2, 'auto')
      h2.onActivity = () => {
        activityCalls++
      }

      expect(tick).toBeDefined()
      tick!()
      expect(activityCalls).toBe(1)
      tick!()
      expect(activityCalls).toBe(2)

      h2.close()
      expect(mockClearInterval).toHaveBeenCalledWith(99)
    } finally {
      globalThis.setInterval = origSetInterval
      globalThis.clearInterval = origClearInterval
      handler.close()
      child.kill()
    }
  })

  test('clears heartbeat on close()', () => {
    const child = spawn('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] })
    const handler = new AcpProtocolHandler(child, 'auto')

    // Access private field via any
    const timer = (handler as any).heartbeatTimer
    expect(timer).toBeDefined()

    handler.close()

    // After close, the timer should be cleared
    expect((handler as any).heartbeatTimer).toBeUndefined()
    child.kill()
  })
})
