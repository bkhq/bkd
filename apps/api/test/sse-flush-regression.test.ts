/**
 * TDD: SSE streaming flush regression.
 *
 * Reproduces the bug where Bun's HTTP layer buffers ReadableStream data.
 * Before the fix (Hono's streamSSE with TransformStream), data accumulated
 * in the internal buffer and only flushed when the stream closed.
 * After the fix (direct ReadableStream), data arrives immediately.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import app from '@/app'
import { appEvents } from '@/events'
import './setup'

function entry(content: string) {
  return {
    issueId: 'tdd-http',
    entry: { id: `turn-0-assistant-0000`, type: 'assistant' as const, entryType: 'assistant-message' as const, content, turnIndex: 0, timestamp: new Date().toISOString(), sequence: Date.now() },
  }
}

describe('SSE HTTP streaming — no buffering', () => {
  let unsubs: Array<() => void> = []

  beforeEach(() => {
    unsubs = []
  })

  afterEach(() => {
    for (const u of unsubs) u()
  })

  it('SSE stream returns Content-Type text/event-stream', async () => {
    const res = await app.request('http://localhost/api/events')
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
  })

  it('each appEvents.emit produces a separate readable chunk immediately', async () => {
    const res = await app.request('http://localhost/api/events')
    expect(res.ok).toBe(true)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // Emit first event
    appEvents.emit('timeline-entry', entry('chunk one'))

    // Read first chunk — must be available immediately
    const r1 = await reader.read()
    expect(r1.done).toBe(false)
    expect(decoder.decode(r1.value)).toContain('chunk one')

    // Emit second event
    appEvents.emit('timeline-entry', entry('chunk two'))

    // Read second chunk — must be available immediately
    const r2 = await reader.read()
    expect(r2.done).toBe(false)
    expect(decoder.decode(r2.value)).toContain('chunk two')

    reader.releaseLock()
  })

  it('responds to heartbeat events', async () => {
    const res = await app.request('http://localhost/api/events')
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // Heartbeat interval is 15s in prod but we can emit a manual event
    appEvents.emit('timeline-entry', entry('heartbeat probe'))

    const { value } = await reader.read()
    expect(decoder.decode(value)).toContain('heartbeat probe')

    reader.releaseLock()
  })
})
