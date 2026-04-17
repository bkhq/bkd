import { describe, expect, test } from 'bun:test'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeSdkNormalizer, SdkProcessHandle } from '@/engines/executors/claude-sdk'
import { PushableStream } from '@/engines/executors/claude-sdk/pushable-stream'
import { getClaudeBackend } from '@/engines/executors/index'

// ---------- PushableStream ----------

describe('PushableStream', () => {
  test('delivers queued values before close', async () => {
    const stream = new PushableStream<number>()
    stream.push(1)
    stream.push(2)
    stream.close()

    const collected: number[] = []
    for await (const v of stream) collected.push(v)
    expect(collected).toEqual([1, 2])
  })

  test('resolves pending consumer when value arrives', async () => {
    const stream = new PushableStream<string>()
    const iter = stream[Symbol.asyncIterator]()
    const firstPromise = iter.next()
    stream.push('hello')
    const first = await firstPromise
    expect(first.done).toBe(false)
    expect(first.value).toBe('hello')
  })

  test('close resolves pending consumers with done', async () => {
    const stream = new PushableStream<number>()
    const iter = stream[Symbol.asyncIterator]()
    const pending = iter.next()
    stream.close()
    const result = await pending
    expect(result.done).toBe(true)
  })

  test('push after close is a no-op', () => {
    const stream = new PushableStream<number>()
    stream.close()
    stream.push(42) // should not throw
    expect(stream.isClosed).toBe(true)
  })
})

// ---------- SdkProcessHandle ----------

function makeMockQuery(): Query & {
  interruptCount: number
  closeCount: number
} {
  let interruptCount = 0
  let closeCount = 0
  const q = {
    get interruptCount() {
      return interruptCount
    },
    get closeCount() {
      return closeCount
    },
    interrupt: async (): Promise<void> => {
      interruptCount++
    },
    close: (): void => {
      closeCount++
    },
  } as unknown as Query & { interruptCount: number, closeCount: number }
  return q
}

describe('SdkProcessHandle', () => {
  test('first kill triggers interrupt, second triggers close, third is no-op', () => {
    const q = makeMockQuery()
    const handle = new SdkProcessHandle(q)
    handle.kill()
    handle.kill()
    handle.kill()
    expect(q.interruptCount).toBe(1)
    expect(q.closeCount).toBe(1)
  })

  test('settle resolves exited promise exactly once', async () => {
    const q = makeMockQuery()
    const handle = new SdkProcessHandle(q)
    handle.settle(0)
    handle.settle(42) // ignored
    await expect(handle.exited).resolves.toBe(0)
    expect(handle.isSettled).toBe(true)
  })

  test('pid is undefined (SDK does not expose child pid)', () => {
    const q = makeMockQuery()
    const handle = new SdkProcessHandle(q)
    expect(handle.pid).toBeUndefined()
  })
})

// ---------- ClaudeSdkNormalizer ----------

describe('ClaudeSdkNormalizer', () => {
  test('wraps legacy normalizer via JSON round-trip on assistant message', () => {
    const norm = new ClaudeSdkNormalizer()
    const raw = JSON.stringify({
      type: 'assistant',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        id: 'msg1',
        content: [{ type: 'text', text: 'hello' }],
      },
    })
    const result = norm.parse(raw)
    expect(result).not.toBeNull()
    const first = Array.isArray(result) ? result[0] : result
    expect(first?.entryType).toBe('assistant-message')
    expect(first?.content).toBe('hello')
  })

  test('parseMessage accepts a structured SDKMessage', () => {
    const norm = new ClaudeSdkNormalizer()
    const result = norm.parseMessage({
      type: 'system',
      subtype: 'init',
      slash_commands: ['/foo'],
      agents: ['a'],
      plugins: [],
    } as unknown as Parameters<typeof norm.parseMessage>[0])
    expect(result).not.toBeNull()
  })
})

// ---------- Backend selection ----------

describe('getClaudeBackend', () => {
  const prev = process.env.CLAUDE_ENGINE_BACKEND

  test('defaults to legacy when unset', () => {
    delete process.env.CLAUDE_ENGINE_BACKEND
    expect(getClaudeBackend()).toBe('legacy')
  })

  test('honors sdk', () => {
    process.env.CLAUDE_ENGINE_BACKEND = 'sdk'
    expect(getClaudeBackend()).toBe('sdk')
  })

  test('honors legacy', () => {
    process.env.CLAUDE_ENGINE_BACKEND = 'legacy'
    expect(getClaudeBackend()).toBe('legacy')
  })

  test('unknown value falls back to legacy', () => {
    process.env.CLAUDE_ENGINE_BACKEND = 'nonsense'
    expect(getClaudeBackend()).toBe('legacy')
  })

  // restore
  test('restore env', () => {
    if (prev === undefined) delete process.env.CLAUDE_ENGINE_BACKEND
    else process.env.CLAUDE_ENGINE_BACKEND = prev
  })
})
