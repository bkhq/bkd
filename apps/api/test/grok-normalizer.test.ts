import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GrokLogNormalizer } from '@/engines/executors/grok'
import type { NormalizedLogEntry } from '@/engines/types'

/**
 * Grok Build headless output (`--output-format streaming-messages-json`).
 * The fixture is a real grok 1.0.41 transcript: list_dir, grep, read_file,
 * search_replace, write, run_terminal_command, todo_write, then `result`.
 */
const FIXTURE = readFileSync(join(import.meta.dir, 'fixtures/grok-session.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)

function parseAll(normalizer: GrokLogNormalizer, rawLine: string): NormalizedLogEntry[] {
  const result = normalizer.parse(rawLine)
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

function runFixture(): NormalizedLogEntry[] {
  const normalizer = new GrokLogNormalizer()
  return FIXTURE.flatMap(l => parseAll(normalizer, l))
}

function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj)
}

describe('GrokLogNormalizer — fixture transcript', () => {
  const entries = runFixture()
  const calls = entries.filter(e => e.entryType === 'tool-use' && !e.metadata?.isResult)
  const results = entries.filter(e => e.metadata?.isResult === true)

  test('init becomes a system-message carrying the session id', () => {
    const init = entries.find(e => e.metadata?.subtype === 'init')
    expect(init?.entryType).toBe('system-message')
    expect(init?.metadata?.sessionId).toBe('11111111-2222-4333-8444-555555555555')
    expect(init?.metadata?.model).toBe('grok-4.6')
    expect(init?.metadata?.slashCommands).toEqual(['compact', 'review'])
  })

  test('tool calls map to BKD tool actions', () => {
    const byName = Object.fromEntries(calls.map(e => [e.metadata?.toolName as string, e]))

    expect(byName.list_dir?.toolAction).toEqual({ kind: 'search', query: 'src' })
    expect(byName.grep?.toolAction).toEqual({ kind: 'search', query: 'const' })
    expect(byName.read_file?.toolAction).toEqual({ kind: 'file-read', path: 'notes.txt' })
    expect(byName.search_replace?.toolAction).toEqual({ kind: 'file-edit', path: 'notes.txt' })
    expect(byName.write?.toolAction).toEqual({ kind: 'file-edit', path: 'b.txt' })
    expect(byName.run_terminal_command?.toolAction).toMatchObject({
      kind: 'command-run',
      command: 'cat notes.txt b.txt',
      category: 'read',
    })
    expect(byName.todo_write?.toolAction).toEqual({
      kind: 'task-plan',
      items: [
        { content: 'Completed requested file edits', status: 'completed' },
        { content: 'Remaining follow-up work', status: 'pending' },
      ],
    })
  })

  test('tool calls carry display content and a tool detail', () => {
    const cmd = calls.find(e => e.metadata?.toolName === 'run_terminal_command')
    expect(cmd?.content).toBe('cat notes.txt b.txt')
    expect(cmd?.toolDetail).toMatchObject({
      kind: 'command-run',
      toolName: 'run_terminal_command',
      isResult: false,
    })
    expect(cmd?.toolDetail?.toolCallId).toBe(cmd?.metadata?.toolCallId as string)
  })

  test('tool results decode the JSON payload into readable text', () => {
    const text = (name: string) => results.find(e => e.metadata?.toolName === name)?.content

    expect(text('list_dir')).toBe('- /tmp/grok-fx/src/\n  - a.ts')
    expect(text('grep')).toBe('/tmp/grok-fx/src/a.ts:1: export const a = 1')
    expect(text('read_file')).toBe('hello\n')
    expect(text('search_replace')).toBe('The file notes.txt has been updated successfully.')
    expect(text('write')).toBe('The file /tmp/grok-fx/b.txt has been created.')
    expect(text('run_terminal_command')).toBe('exit: 0\nhi\nbee')
    expect(text('todo_write')).toContain('[completed] 1: Completed requested file edits')
  })

  test('every tool result is linked to its call', () => {
    expect(results).toHaveLength(calls.length)
    for (const r of results) {
      expect(r.entryType).toBe('tool-use')
      expect(r.toolDetail?.isResult).toBe(true)
      expect(calls.some(c => c.metadata?.toolCallId === r.metadata?.toolCallId)).toBe(true)
    }
  })

  test('thinking and assistant text are emitted', () => {
    expect(entries.some(e => e.entryType === 'thinking' && e.content.length > 0)).toBe(true)
    const last = entries.filter(e => e.entryType === 'assistant-message').at(-1)
    expect(last?.content).toBe('ok')
  })

  test('message_delta usage becomes token-usage entries', () => {
    const usage = entries.filter(e => e.entryType === 'token-usage')
    expect(usage.length).toBeGreaterThan(0)
    expect(usage[0]?.metadata?.inputTokens).toBe(24664)
    expect(usage[0]?.metadata?.outputTokens).toBe(174)
  })

  test('result completes the turn with usage and cost', () => {
    const result = entries.find(e => e.metadata?.turnCompleted === true)
    expect(result?.entryType).toBe('system-message')
    expect(result?.metadata).toMatchObject({
      resultSubtype: 'success',
      isError: false,
      sessionId: '11111111-2222-4333-8444-555555555555',
      inputTokens: 50215 + 150272,
      outputTokens: 556,
      costUsd: 0.178902,
    })
    const modelUsage = result?.metadata?.modelUsage as Record<string, { contextWindow: number }>
    expect(modelUsage['grok-4.6']?.contextWindow).toBe(500000)
  })

  test('result text already shown as the last assistant message is not repeated', () => {
    expect(entries.filter(e => e.content === 'ok')).toHaveLength(1)
  })
})

describe('GrokLogNormalizer — edge cases', () => {
  test('error result is an error-message and a turn completion', () => {
    const [entry] = parseAll(
      new GrokLogNormalizer(),
      line({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom', session_id: 's1' }),
    )
    expect(entry?.entryType).toBe('error-message')
    expect(entry?.metadata).toMatchObject({ turnCompleted: true, isError: true, resultSubtype: 'error_during_execution' })
  })

  test('failed tool result is an error-message', () => {
    const n = new GrokLogNormalizer()
    parseAll(n, line({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { target_file: 'x' } }] },
    }))
    const [entry] = parseAll(n, line({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'No such file', is_error: true }] },
    }))
    expect(entry?.entryType).toBe('error-message')
    expect(entry?.content).toBe('No such file')
    expect(entry?.metadata?.toolName).toBe('read_file')
  })

  test('assistant blocks are emitted in the order the model produced them', () => {
    const entries = parseAll(new GrokLogNormalizer(), line({
      type: 'assistant',
      message: {
        id: 'm1',
        content: [
          { type: 'thinking', thinking: 'plan', signature: 's' },
          { type: 'text', text: 'Reading it.' },
          { type: 'tool_use', id: 't1', name: 'read_file', input: { target_file: 'a' } },
        ],
      },
    }))
    expect(entries.map(e => e.entryType)).toEqual(['thinking', 'assistant-message', 'tool-use'])
  })

  test('unknown tools fall back to a generic tool action', () => {
    const [entry] = parseAll(new GrokLogNormalizer(), line({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'image_gen', input: { prompt: 'cat' } }] },
    }))
    expect(entry?.toolAction).toEqual({ kind: 'tool', toolName: 'image_gen', arguments: { prompt: 'cat' } })
    expect(entry?.content).toBe('Tool: image_gen')
  })

  test('unknown result payload types are kept as raw text', () => {
    const n = new GrokLogNormalizer()
    const [entry] = parseAll(n, line({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '{"type":"Mystery","a":1}' }] },
    }))
    expect(entry?.content).toBe('{"type":"Mystery","a":1}')
  })

  test('non-JSON lines surface as system messages, blank lines are dropped', () => {
    const n = new GrokLogNormalizer()
    expect(parseAll(n, 'warning: something')).toEqual([{ entryType: 'system-message', content: 'warning: something' }])
    expect(parseAll(n, '   ')).toEqual([])
  })

  test('content_block_delta stream events are ignored', () => {
    const n = new GrokLogNormalizer()
    expect(parseAll(n, line({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
    }))).toEqual([])
  })
})
