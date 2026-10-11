import { describe, expect, test } from 'bun:test'
import { consumeStderr } from '@/engines/issue/streams/consumer'
import type { ManagedProcess } from '@/engines/issue/types'
import { isVisible } from '@/engines/issue/utils/visibility'
import type { NormalizedLogEntry } from '@/engines/types'

/**
 * Engine-reported errors must reach the chat; only raw stderr stays hidden.
 *
 * Hiding every `error-message` entry made Codex policy blocks, failed turns
 * and stream disconnects invisible: the issue moved to review with no reason.
 */

const error = (metadata?: Record<string, unknown>): NormalizedLogEntry => ({
  entryType: 'error-message',
  content: 'boom',
  ...(metadata ? { metadata } : {}),
})

describe('isVisible — error entries', () => {
  test('hides raw stderr lines', () => {
    expect(isVisible(error({ source: 'stderr' }))).toBe(false)
  })

  test('shows an engine error notification', () => {
    expect(isVisible(error({ errorKind: 'cyberPolicy', willRetry: false }))).toBe(true)
  })

  test('shows a failed turn', () => {
    expect(isVisible(error({ source: 'result', turnCompleted: true, resultSubtype: 'failed', isError: true }))).toBe(true)
  })

  test('shows an error with no metadata (emitErrorLog, stream read error)', () => {
    expect(isVisible(error())).toBe(true)
  })
})

describe('consumeStderr', () => {
  test('tags stderr entries as stderr', async () => {
    const entries: NormalizedLogEntry[] = []
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('ERROR codex_app_server: bubblewrap missing\n'))
        c.close()
      },
    })
    await consumeStderr('exec', 'issue', stream, {
      getManaged: () => ({ lastActivityAt: new Date() }) as unknown as ManagedProcess,
      getTurnIndex: () => 0,
      onEntry: entry => entries.push(entry),
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.entryType).toBe('error-message')
    expect(entries[0]!.metadata?.source).toBe('stderr')
    expect(isVisible(entries[0]!)).toBe(false)
  })
})
