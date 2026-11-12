import { describe, expect, test } from 'bun:test'
import type { NormalizedLogEntry } from '@bkd/shared'
import { ExecutionStore } from '@/engines/issue/store/execution-store'

function entry(content: string, turnIndex = 0): NormalizedLogEntry {
  return { entryType: 'assistant-message', content, turnIndex }
}

describe('ExecutionStore', () => {
  test('keeps entries in arrival order', () => {
    const store = new ExecutionStore('exec-1')
    store.push(entry('a'))
    store.push(entry('b', 1))
    expect(store.length).toBe(2)
    expect(store.toArray().map(e => e.content)).toEqual(['a', 'b'])
  })

  test('toArray returns a copy', () => {
    const store = new ExecutionStore('exec-2')
    store.push(entry('a'))
    store.toArray().push(entry('b'))
    expect(store.length).toBe(1)
  })

  test('is empty and ignores writes after destroy', () => {
    const store = new ExecutionStore('exec-3')
    store.push(entry('a'))
    store.destroy()
    store.push(entry('b'))
    expect(store.length).toBe(0)
    expect(store.toArray()).toEqual([])
  })
})
