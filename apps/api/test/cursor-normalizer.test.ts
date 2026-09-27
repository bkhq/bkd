import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CursorLogNormalizer } from '@/engines/executors/cursor'
import type { NormalizedLogEntry } from '@/engines/types'

/**
 * Cursor CLI headless output (`cursor-agent -p --output-format stream-json`).
 * The fixture is a real 2026.09.23 transcript: thinking, shell, read, edit
 * (create + modify), grep, glob, getMcpTools, then `result`.
 */
const FIXTURE = readFileSync(join(import.meta.dir, 'fixtures/cursor-session.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)

function parseAll(normalizer: CursorLogNormalizer, rawLine: string): NormalizedLogEntry[] {
  const result = normalizer.parse(rawLine)
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

function runFixture(): NormalizedLogEntry[] {
  const normalizer = new CursorLogNormalizer()
  return FIXTURE.flatMap(l => parseAll(normalizer, l))
}

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

describe('CursorLogNormalizer — fixture transcript', () => {
  const entries = runFixture()
  const calls = entries.filter(e => e.entryType === 'tool-use' && !e.metadata?.isResult)
  const results = entries.filter(e => e.metadata?.isResult === true)

  test('init becomes a system-message carrying the session id', () => {
    const init = entries.find(e => e.metadata?.subtype === 'init')
    expect(init?.entryType).toBe('system-message')
    expect(init?.metadata?.sessionId).toBe('11111111-2222-4333-8444-555555555555')
    expect(init?.metadata?.model).toBe('Auto')
    expect(init?.metadata?.cwd).toBe('/tmp/cursor-probe')
  })

  test('the user prompt echo is dropped', () => {
    expect(entries.filter(e => e.entryType === 'user-message')).toHaveLength(0)
  })

  test('thinking deltas are joined into one entry on completed', () => {
    const thinking = entries.filter(e => e.entryType === 'thinking')
    expect(thinking).toHaveLength(1)
    expect(thinking[0]!.content).toBe('I will execute the seven requested operations in sequence.')
  })

  test('assistant text becomes assistant-message entries', () => {
    const texts = entries.filter(e => e.entryType === 'assistant-message').map(e => e.content)
    expect(texts[0]).toContain('先列出 `src` 目录')
    expect(texts.at(-1)).toContain('已按序完成')
  })

  test('every tool call has a matching result', () => {
    expect(calls).toHaveLength(7)
    expect(results).toHaveLength(7)
    for (const c of calls) {
      expect(results.some(r => r.metadata?.toolCallId === c.metadata?.toolCallId)).toBe(true)
    }
  })

  test('shell maps to command-run with the command and its output', () => {
    const call = calls.find(c => c.metadata?.toolName === 'shell')
    expect(call?.toolAction).toMatchObject({ kind: 'command-run', command: 'ls -la src' })
    expect(call?.content).toBe('ls -la src')
    const result = results.find(r => r.metadata?.toolCallId === call?.metadata?.toolCallId)
    expect(result?.content).toContain('a.txt')
    expect(result?.toolDetail?.kind).toBe('command-run')
  })

  test('read maps to file-read with the decoded file content', () => {
    const call = calls.find(c => c.metadata?.toolName === 'read')
    expect(call?.toolAction).toEqual({ kind: 'file-read', path: '/tmp/cursor-probe/src/a.txt' })
    const result = results.find(r => r.metadata?.toolCallId === call?.metadata?.toolCallId)
    expect(result?.content).toBe('hello\nworld\n')
  })

  test('edit maps to file-edit and its result shows the diff', () => {
    const edits = calls.filter(c => c.metadata?.toolName === 'edit')
    expect(edits).toHaveLength(2)
    expect(edits[0]?.toolAction).toEqual({ kind: 'file-edit', path: '/tmp/cursor-probe/src/b.txt' })
    const result = results.find(r => r.metadata?.toolCallId === edits[1]?.metadata?.toolCallId)
    expect(result?.content).toContain('-world')
    expect(result?.content).toContain('+earth')
  })

  test('grep maps to search and lists file:line matches', () => {
    const call = calls.find(c => c.metadata?.toolName === 'grep')
    expect(call?.toolAction).toEqual({ kind: 'search', query: 'hello' })
    expect(call?.content).toBe('hello in /tmp/cursor-probe/src')
    const result = results.find(r => r.metadata?.toolCallId === call?.metadata?.toolCallId)
    expect(result?.content).toBe('src/a.txt:1: hello')
  })

  test('glob maps to search and lists the files', () => {
    const call = calls.find(c => c.metadata?.toolName === 'glob')
    expect(call?.toolAction).toEqual({ kind: 'search', query: '*.txt' })
    const result = results.find(r => r.metadata?.toolCallId === call?.metadata?.toolCallId)
    expect(result?.content).toBe('./src/a.txt\n./src/b.txt')
  })

  test('unknown variants degrade to a generic tool entry', () => {
    const call = calls.find(c => c.metadata?.toolName === 'getMcpTools')
    expect(call?.toolAction?.kind).toBe('tool')
    expect(call?.content).toBe('Tool: getMcpTools')
    const result = results.find(r => r.metadata?.toolCallId === call?.metadata?.toolCallId)
    expect(result?.content).toContain('"mode": "search"')
  })

  test('result signals turn completion with token usage and no duplicate text', () => {
    const done = entries.find(e => e.metadata?.turnCompleted === true)
    expect(done?.entryType).toBe('system-message')
    expect(done?.metadata).toMatchObject({
      resultSubtype: 'success',
      isError: false,
      sessionId: '11111111-2222-4333-8444-555555555555',
      inputTokens: 21904 + 92544,
      outputTokens: 1168,
      duration: 36680,
    })
    // `result.result` concatenates the assistant texts already emitted
    const last = entries.at(-1)
    expect(last?.metadata?.turnCompleted).toBe(true)
  })
})

describe('CursorLogNormalizer — single lines', () => {
  test('result text is emitted when no assistant text preceded it', () => {
    const n = new CursorLogNormalizer()
    const out = parseAll(n, line({ type: 'result', subtype: 'success', is_error: false, result: 'hi', session_id: 's' }))
    expect(out.map(e => e.entryType)).toEqual(['system-message', 'assistant-message'])
    expect(out[1]!.content).toBe('hi')
  })

  test('error result is an error-message with isError', () => {
    const n = new CursorLogNormalizer()
    const out = parseAll(n, line({ type: 'result', subtype: 'error', is_error: true, result: 'boom', session_id: 's' }))
    expect(out[0]!.entryType).toBe('error-message')
    expect(out[0]!.metadata).toMatchObject({ turnCompleted: true, isError: true, error: 'boom' })
    expect(out).toHaveLength(1)
  })

  test('a failed tool result is an error-message but not a logical failure', () => {
    const n = new CursorLogNormalizer()
    parseAll(n, line({ type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: { shellToolCall: { args: { command: 'false' } } } }))
    const out = parseAll(n, line({ type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { shellToolCall: { args: { command: 'false' }, result: { error: { message: 'exit 1' } } } } }))
    expect(out[0]!.entryType).toBe('error-message')
    expect(out[0]!.content).toContain('exit 1')
    expect(out[0]!.metadata?.isError).toBeUndefined()
  })

  test('shell result includes stderr and a non-zero exit code', () => {
    const n = new CursorLogNormalizer()
    parseAll(n, line({ type: 'tool_call', subtype: 'started', call_id: 'c1', tool_call: { shellToolCall: { args: { command: 'cat x' } } } }))
    const out = parseAll(n, line({ type: 'tool_call', subtype: 'completed', call_id: 'c1', tool_call: { shellToolCall: { args: { command: 'cat x' }, result: { success: { stdout: '', stderr: 'cat: x: No such file', exitCode: 1 } } } } }))
    expect(out[0]!.entryType).toBe('tool-use')
    expect(out[0]!.content).toBe('cat: x: No such file\n[exit 1]')
  })

  test('write and delete map to file-edit, updateTodos to task-plan', () => {
    const n = new CursorLogNormalizer()
    const write = parseAll(n, line({ type: 'tool_call', subtype: 'started', call_id: 'w', tool_call: { writeToolCall: { args: { path: 'a.txt', fileText: 'x' } } } }))
    expect(write[0]!.toolAction).toEqual({ kind: 'file-edit', path: 'a.txt' })
    const del = parseAll(n, line({ type: 'tool_call', subtype: 'started', call_id: 'd', tool_call: { deleteToolCall: { args: { path: 'a.txt' } } } }))
    expect(del[0]!.toolAction).toEqual({ kind: 'file-edit', path: 'a.txt' })
    const todos = parseAll(n, line({ type: 'tool_call', subtype: 'started', call_id: 't', tool_call: { updateTodosToolCall: { args: { todos: [{ content: 'one', status: 'pending' }, { content: 'two', status: 'completed' }] } } } }))
    expect(todos[0]!.toolAction).toEqual({ kind: 'task-plan', items: [{ content: 'one', status: 'pending' }, { content: 'two', status: 'completed' }] })
  })

  test('non-JSON lines become system messages, unknown types are dropped', () => {
    const n = new CursorLogNormalizer()
    expect(parseAll(n, 'Tip: You can start the Cursor CLI with `agent`')[0]?.entryType).toBe('system-message')
    expect(parseAll(n, line({ type: 'user', message: { content: [] } }))).toEqual([])
    expect(parseAll(n, line({ type: 'whatever' }))).toEqual([])
    expect(parseAll(n, '')).toEqual([])
  })
})
