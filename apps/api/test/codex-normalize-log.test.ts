import { describe, expect, test } from 'bun:test'
import { CodexExecutor } from '@/engines/executors/codex'
import type { NormalizedLogEntry } from '@/engines/types'

const executor = new CodexExecutor()

function asSingleEntry(
  result: NormalizedLogEntry | NormalizedLogEntry[] | null,
): NormalizedLogEntry | null {
  if (!result) return null
  return Array.isArray(result) ? (result[0] ?? null) : result
}

function normalize(method: string, params?: Record<string, unknown>) {
  return asSingleEntry(executor.normalizeLog(JSON.stringify({ method, params })))
}

describe('CodexExecutor.normalizeLog', () => {
  // ------------------------------------------------------------------
  // 1. item/agentMessage/delta
  // ------------------------------------------------------------------
  describe('item/agentMessage/delta', () => {
    test('returns streaming assistant-message with accumulated text', () => {
      const entry = normalize('item/agentMessage/delta', {
        delta: 'Hello world',
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('assistant-message')
      expect(entry!.content).toBe('Hello world')
      expect(entry!.metadata?.streaming).toBe(true)
    })

    test('returns null when delta is empty', () => {
      const entry = normalize('item/agentMessage/delta', {})
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 2. item/started
  // ------------------------------------------------------------------
  describe('item/started', () => {
    test('commandExecution returns tool-use', () => {
      const entry = normalize('item/started', {
        item: { type: 'commandExecution', id: 'cmd-1' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('Tool: Bash')
      expect(entry!.metadata?.toolName).toBe('Bash')
      expect(entry!.metadata?.toolCallId).toBe('cmd-1')
      expect(entry!.metadata?.streaming).toBeUndefined()
      expect(entry!.metadata?.isResult).toBeUndefined()
    })

    test('fileChange returns tool-use with path from changes array', () => {
      const entry = normalize('item/started', {
        item: {
          type: 'fileChange',
          id: 'fc-1',
          changes: [{ path: '/tmp/test.ts', kind: { type: 'update' }, diff: '--- a\n+++ b' }],
          status: 'inProgress',
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('Tool: Edit')
      expect(entry!.metadata?.path).toBe('/tmp/test.ts')
      expect(entry!.metadata?.input).toEqual({
        file_path: '/tmp/test.ts',
        changeType: 'update',
        unified_diff: '--- a\n+++ b',
      })
      expect(entry!.metadata?.streaming).toBeUndefined()
      expect(entry!.metadata?.isResult).toBeUndefined()
    })

    test('agentMessage returns null (canonical text emitted by item/completed)', () => {
      const entry = normalize('item/started', {
        item: { type: 'agentMessage', text: 'I will help you' },
      })
      expect(entry).toBeNull()
    })

    test('reasoning returns null', () => {
      const entry = normalize('item/started', {
        item: { type: 'reasoning', text: 'thinking...' },
      })
      expect(entry).toBeNull()
    })

    test('unknown item type returns null', () => {
      const entry = normalize('item/started', {
        item: { type: 'unknown_type' },
      })
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 3. item/completed
  // ------------------------------------------------------------------
  describe('item/completed', () => {
    test('commandExecution with aggregatedOutput and exit code', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'commandExecution',
          id: 'cmd-done',
          command: 'ls -la',
          aggregatedOutput: 'file1.ts\nfile2.ts',
          exitCode: 0,
          durationMs: 150,
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('file1.ts\nfile2.ts')
      expect(entry!.metadata?.isResult).toBe(true)
      expect(entry!.metadata?.exitCode).toBe(0)
      expect(entry!.metadata?.duration).toBe(150)
      expect(entry!.toolAction).toEqual({
        kind: 'command-run',
        command: 'ls -la',
        result: 'file1.ts\nfile2.ts',
        category: 'read',
      })
    })

    test('commandExecution with empty output', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'commandExecution',
          command: 'npm install',
          exitCode: 0,
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('')
    })

    test('fileChange with multiple changes', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'fileChange',
          id: 'fc-done',
          changes: [
            { path: '/app/index.ts', kind: { type: 'update' }, diff: 'diff1' },
            { path: '/app/utils.ts', kind: { type: 'add' }, diff: 'diff2' },
          ],
          status: 'completed',
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('2 files changed: /app/index.ts, /app/utils.ts')
      expect(entry!.metadata?.isResult).toBe(true)
      expect(entry!.metadata?.path).toBe('/app/index.ts')
      expect(entry!.metadata?.changedPaths).toEqual(['/app/index.ts', '/app/utils.ts'])
      expect(entry!.toolAction).toEqual({
        kind: 'file-edit',
        path: '/app/index.ts',
      })
    })

    test('fileChange single file', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'fileChange',
          id: 'fc-single',
          changes: [{ path: '/app/test.ts', kind: { type: 'update' }, diff: 'diff' }],
          status: 'completed',
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('File changed: /app/test.ts')
    })

    test('agentMessage returns assistant-message with final text', () => {
      const entry = normalize('item/completed', {
        item: { type: 'agentMessage', text: 'Done!' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('assistant-message')
      expect(entry!.content).toBe('Done!')
    })

    test('reasoning returns null', () => {
      const entry = normalize('item/completed', {
        item: { type: 'reasoning' },
      })
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 4. Streaming output deltas
  // ------------------------------------------------------------------
  describe('streaming deltas', () => {
    test('commandExecution/outputDelta returns tool-use streaming', () => {
      const entry = normalize('item/commandExecution/outputDelta', {
        delta: 'some output\n',
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('some output\n')
      expect(entry!.metadata?.isResult).toBe(true)
      expect(entry!.metadata?.streaming).toBe(true)
    })

    test('commandExecution/outputDelta returns null on empty delta', () => {
      const entry = normalize('item/commandExecution/outputDelta', {})
      expect(entry).toBeNull()
    })

    test('fileChange/outputDelta returns tool-use streaming', () => {
      const entry = normalize('item/fileChange/outputDelta', {
        delta: 'diff content',
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('diff content')
      expect(entry!.metadata?.streaming).toBe(true)
    })

    test('fileChange/outputDelta returns null on empty delta', () => {
      const entry = normalize('item/fileChange/outputDelta', {})
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 5. Turn lifecycle
  // ------------------------------------------------------------------
  describe('turn lifecycle', () => {
    test('turn/started returns system-message with turn ID', () => {
      const entry = normalize('turn/started', { turn: { id: 'turn-123' } })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('Turn started')
      expect(entry!.metadata?.subtype).toBe('turn_started')
      expect(entry!.metadata?.turnId).toBe('turn-123')
    })

    test('turn/completed with token usage formats large numbers', () => {
      const entry = normalize('turn/completed', {
        turn: {
          id: 'turn-done',
          usage: { inputTokens: 12500, outputTokens: 3400 },
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('12.5k input \u00B7 3.4k output')
      expect(entry!.metadata?.turnCompleted).toBe(true)
      expect(entry!.metadata?.inputTokens).toBe(12500)
      expect(entry!.metadata?.outputTokens).toBe(3400)
    })

    test('turn/completed with small token numbers uses raw count', () => {
      const entry = normalize('turn/completed', {
        turn: {
          id: 'turn-small',
          usage: { inputTokens: 500, outputTokens: 100 },
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('500 input \u00B7 100 output')
    })

    test('turn/completed without usage says Turn completed', () => {
      const entry = normalize('turn/completed', {
        turn: { id: 'turn-no-usage' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('Turn completed')
    })
  })

  // ------------------------------------------------------------------
  // 6. Thread lifecycle
  // ------------------------------------------------------------------
  describe('thread lifecycle', () => {
    test('thread/started returns system-message', () => {
      const entry = normalize('thread/started', { threadId: 'thr-abc' })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('Thread started')
      expect(entry!.metadata?.threadId).toBe('thr-abc')
    })

    test('thread/status/changed with systemError returns error-message', () => {
      const entry = normalize('thread/status/changed', {
        status: 'systemError',
        message: 'connection lost',
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('error-message')
      expect(entry!.content).toBe('Thread error: connection lost')
    })

    test('thread/status/changed with non-error returns null', () => {
      const entry = normalize('thread/status/changed', { status: 'idle' })
      expect(entry).toBeNull()
    })
  })

  // ------------------------------------------------------------------
  // 7. Error notification
  // ------------------------------------------------------------------
  describe('error notification', () => {
    test('error method returns error-message with willRetry', () => {
      const entry = normalize('error', {
        error: { code: 429, message: 'Rate limited' },
        willRetry: true,
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('error-message')
      expect(entry!.content).toBe('Rate limited')
      expect(entry!.metadata?.code).toBe(429)
      expect(entry!.metadata?.willRetry).toBe(true)
    })

    test('error without message shows Unknown error', () => {
      const entry = normalize('error', { error: {} })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('Unknown error')
    })
  })

  // ------------------------------------------------------------------
  // 8. Reasoning (skipped)
  // ------------------------------------------------------------------
  describe('reasoning', () => {
    test('item/reasoning/textDelta returns streaming thinking entry', () => {
      const entry = normalize('item/reasoning/textDelta', { delta: 'thinking...' })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('thinking')
      expect(entry!.content).toBe('thinking...')
      expect(entry!.metadata?.streaming).toBe(true)
    })

    test('item/reasoning/summaryTextDelta returns streaming thinking entry', () => {
      const entry = normalize('item/reasoning/summaryTextDelta', { delta: 'summary' })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('thinking')
      expect(entry!.content).toBe('summary')
      expect(entry!.metadata?.streaming).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // 9. Edge cases
  // ------------------------------------------------------------------
  describe('edge cases', () => {
    test('unknown notification method returns null', () => {
      expect(normalize('some/future/method', { data: 'whatever' })).toBeNull()
    })

    test('no method field returns null', () => {
      const entry = executor.normalizeLog(JSON.stringify({ data: 'no method' }))
      expect(entry).toBeNull()
    })

    test('non-JSON line returns system-message', () => {
      const entry = executor.normalizeLog('some plain text output')
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('some plain text output')
    })

    test('empty string returns null', () => {
      const entry = executor.normalizeLog('')
      expect(entry).toBeNull()
    })

    test('whitespace-only string returns null', () => {
      const entry = executor.normalizeLog('   ')
      expect(entry).toBeNull()
    })

    test('all entries have a timestamp', () => {
      const entry = normalize('turn/started', { turn: { id: 'ts-1' } })
      expect(entry).not.toBeNull()
      expect(entry!.timestamp).toBeTruthy()
      // Verify ISO 8601 format
      expect(() => new Date(entry!.timestamp!)).not.toThrow()
    })
  })

  // ------------------------------------------------------------------
  // 10. MCP tool call
  // ------------------------------------------------------------------
  describe('mcpToolCall', () => {
    test('item/started mcpToolCall returns tool-use', () => {
      const entry = normalize('item/started', {
        item: { type: 'mcpToolCall', id: 'mcp-1', server: 'myserver', tool: 'mytool', arguments: { q: 'test' } },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.metadata?.toolName).toBe('mcp:myserver:mytool')
      expect(entry!.metadata?.input).toEqual({ q: 'test' })
      expect(entry!.metadata?.streaming).toBeUndefined()
      expect(entry!.metadata?.isResult).toBeUndefined()
    })

    test('item/completed mcpToolCall with result', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'mcpToolCall',
          id: 'mcp-1',
          server: 'srv',
          tool: 'tl',
          status: 'completed',
          result: { content: [{ type: 'text', text: 'result data' }] },
          durationMs: 200,
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.content).toBe('result data')
      expect(entry!.metadata?.isResult).toBe(true)
      expect(entry!.metadata?.exitCode).toBe(0)
      expect(entry!.metadata?.duration).toBe(200)
    })

    test('item/completed mcpToolCall with error', () => {
      const entry = normalize('item/completed', {
        item: { type: 'mcpToolCall', id: 'mcp-2', server: 's', tool: 't', status: 'failed', error: { message: 'timeout' } },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('timeout')
      expect(entry!.metadata?.exitCode).toBe(1)
    })
  })

  // ------------------------------------------------------------------
  // 11. Dynamic tool call
  // ------------------------------------------------------------------
  describe('dynamicToolCall', () => {
    test('item/started dynamicToolCall returns tool-use', () => {
      const entry = normalize('item/started', {
        item: { type: 'dynamicToolCall', id: 'dt-1', tool: 'custom_tool', arguments: { x: 1 } },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.metadata?.toolName).toBe('custom_tool')
      expect(entry!.metadata?.streaming).toBeUndefined()
      expect(entry!.metadata?.isResult).toBeUndefined()
    })

    test('item/completed dynamicToolCall with content', () => {
      const entry = normalize('item/completed', {
        item: {
          type: 'dynamicToolCall',
          id: 'dt-1',
          tool: 'custom_tool',
          status: 'completed',
          success: true,
          contentItems: [{ type: 'text', text: 'output' }],
        },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('output')
      expect(entry!.metadata?.exitCode).toBe(0)
    })
  })

  // ------------------------------------------------------------------
  // 12. Web search
  // ------------------------------------------------------------------
  describe('webSearch', () => {
    test('item/started webSearch returns tool-use', () => {
      const entry = normalize('item/started', {
        item: { type: 'webSearch', id: 'ws-1', query: 'typescript patterns' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('tool-use')
      expect(entry!.metadata?.toolName).toBe('WebSearch')
      expect(entry!.metadata?.streaming).toBeUndefined()
      expect(entry!.metadata?.isResult).toBeUndefined()
    })

    test('item/completed webSearch returns result', () => {
      const entry = normalize('item/completed', {
        item: { type: 'webSearch', id: 'ws-1', query: 'typescript patterns', action: { type: 'search' } },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('typescript patterns')
      expect(entry!.metadata?.actionType).toBe('search')
    })
  })

  // ------------------------------------------------------------------
  // 13. Plan
  // ------------------------------------------------------------------
  describe('plan', () => {
    test('item/plan/delta accumulates streaming text', () => {
      const entry = normalize('item/plan/delta', { delta: 'Step 1' })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('assistant-message')
      expect(entry!.metadata?.isPlan).toBe(true)
      expect(entry!.metadata?.streaming).toBe(true)
    })

    test('item/completed plan returns assistant-message', () => {
      const entry = normalize('item/completed', {
        item: { type: 'plan', id: 'p-1', text: 'Full plan text' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('assistant-message')
      expect(entry!.content).toBe('Full plan text')
      expect(entry!.metadata?.isPlan).toBe(true)
    })
  })

  // ------------------------------------------------------------------
  // 14. Review mode and context compaction
  // ------------------------------------------------------------------
  describe('review mode and compaction', () => {
    test('item/completed enteredReviewMode returns system-message', () => {
      const entry = normalize('item/completed', {
        item: { type: 'enteredReviewMode', id: 'r-1', review: 'Review changes' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('Review changes')
    })

    test('item/completed exitedReviewMode returns system-message', () => {
      const entry = normalize('item/completed', {
        item: { type: 'exitedReviewMode', id: 'r-2', review: '' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('Exited review mode')
    })

    test('item/completed contextCompaction returns system-message', () => {
      const entry = normalize('item/completed', {
        item: { type: 'contextCompaction', id: 'cc-1' },
      })
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('Context compacted')
    })

    test('thread/compacted returns system-message', () => {
      const entry = normalize('thread/compacted', {})
      expect(entry).not.toBeNull()
      expect(entry!.content).toBe('Context compacted')
    })
  })

  // ------------------------------------------------------------------
  // 15. Model rerouted
  // ------------------------------------------------------------------
  describe('model/rerouted', () => {
    test('returns system-message with model names', () => {
      const entry = normalize('model/rerouted', { fromModel: 'o3', toModel: 'o4-mini' })
      expect(entry).not.toBeNull()
      expect(entry!.entryType).toBe('system-message')
      expect(entry!.content).toBe('Model rerouted from o3 to o4-mini')
    })
  })
})

// ------------------------------------------------------------------
// Stateful token usage tracking (ENG-022) + protocol alignment (ENG-023)
// ------------------------------------------------------------------
describe('CodexLogNormalizer token usage (stateful)', () => {
  function feed(
    n: { parse: (line: string) => NormalizedLogEntry | NormalizedLogEntry[] | null },
    method: string,
    params: Record<string, unknown>,
  ) {
    return asSingleEntry(n.parse(JSON.stringify({ method, params })))
  }

  const breakdown = (
    inputTokens: number,
    cachedInputTokens: number,
    outputTokens: number,
    reasoningOutputTokens: number,
  ) => ({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens: inputTokens + outputTokens,
  })

  test('thread/tokenUsage/updated emits token-usage entry from tokenUsage.total', () => {
    const n = executor.createNormalizer()
    const entry = feed(n, 'thread/tokenUsage/updated', {
      threadId: 't1',
      turnId: 'turn1',
      tokenUsage: {
        last: breakdown(100, 40, 20, 5),
        total: breakdown(5100, 1040, 520, 105),
        modelContextWindow: 272000,
      },
    })
    expect(entry).not.toBeNull()
    expect(entry!.entryType).toBe('token-usage')
    expect(entry!.metadata?.totalTokens).toBe(5620)
    expect(entry!.metadata?.contextWindow).toBe(272000)
    expect(entry!.metadata?.inputTokens).toBe(5100)
    expect(entry!.metadata?.outputTokens).toBe(520)
    expect(entry!.metadata?.cachedInputTokens).toBe(1040)
  })

  test('turn/completed carries per-turn token deltas accumulated from tokenUsage totals', () => {
    const n = executor.createNormalizer()
    // First update of the turn: baseline = total - last (thread history)
    feed(n, 'thread/tokenUsage/updated', {
      threadId: 't1',
      turnId: 'turn1',
      tokenUsage: {
        last: breakdown(100, 40, 20, 5),
        total: breakdown(5100, 1040, 520, 105),
        modelContextWindow: 272000,
      },
    })
    // Second update: totals advance by (200 input / 100 cached / 30 output / 5 reasoning)
    feed(n, 'thread/tokenUsage/updated', {
      threadId: 't1',
      turnId: 'turn1',
      tokenUsage: {
        last: breakdown(200, 100, 30, 5),
        total: breakdown(5300, 1140, 550, 110),
        modelContextWindow: 272000,
      },
    })

    const done = feed(n, 'turn/completed', {
      threadId: 't1',
      turn: { id: 'turn1', status: 'completed', items: [] },
    })
    expect(done).not.toBeNull()
    expect(done!.metadata?.turnCompleted).toBe(true)
    expect(done!.metadata?.inputTokens).toBe(300)
    expect(done!.metadata?.outputTokens).toBe(50)
    expect(done!.metadata?.cachedInputTokens).toBe(140)
    expect(done!.metadata?.reasoningOutputTokens).toBe(10)

    // Next turn accumulates independently
    feed(n, 'thread/tokenUsage/updated', {
      threadId: 't1',
      turnId: 'turn2',
      tokenUsage: {
        last: breakdown(80, 0, 10, 0),
        total: breakdown(5380, 1140, 560, 110),
        modelContextWindow: 272000,
      },
    })
    const done2 = feed(n, 'turn/completed', {
      threadId: 't1',
      turn: { id: 'turn2', status: 'completed', items: [] },
    })
    expect(done2!.metadata?.inputTokens).toBe(80)
    expect(done2!.metadata?.outputTokens).toBe(10)
  })

  test('turn/completed keeps legacy turn.usage fallback', () => {
    const n = executor.createNormalizer()
    const done = feed(n, 'turn/completed', {
      threadId: 't1',
      turn: { id: 'turn1', status: 'completed', items: [], usage: { inputTokens: 42, outputTokens: 7 } },
    })
    expect(done!.metadata?.turnCompleted).toBe(true)
    expect(done!.metadata?.inputTokens).toBe(42)
    expect(done!.metadata?.outputTokens).toBe(7)
  })

  test('turn/completed with status failed maps to error entry with errorKind', () => {
    const n = executor.createNormalizer()
    const done = feed(n, 'turn/completed', {
      threadId: 't1',
      turn: {
        id: 'turn1',
        status: 'failed',
        items: [],
        error: { message: 'usage limit reached', codexErrorInfo: 'usageLimitExceeded' },
      },
    })
    expect(done!.entryType).toBe('error-message')
    expect(done!.metadata?.turnCompleted).toBe(true)
    expect(done!.metadata?.isError).toBe(true)
    expect(done!.metadata?.errorKind).toBe('usageLimitExceeded')
    expect(done!.content).toContain('usage limit reached')
  })

  test('turn/completed with object codexErrorInfo uses its variant key', () => {
    const n = executor.createNormalizer()
    const done = feed(n, 'turn/completed', {
      threadId: 't1',
      turn: {
        id: 'turn1',
        status: 'failed',
        items: [],
        error: {
          message: 'connection failed',
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } },
        },
      },
    })
    expect(done!.entryType).toBe('error-message')
    expect(done!.metadata?.errorKind).toBe('httpConnectionFailed')
  })

  test('turn/completed with status interrupted stays a system message', () => {
    const n = executor.createNormalizer()
    const done = feed(n, 'turn/completed', {
      threadId: 't1',
      turn: { id: 'turn1', status: 'interrupted', items: [] },
    })
    expect(done!.entryType).toBe('system-message')
    expect(done!.metadata?.turnCompleted).toBe(true)
    expect(done!.metadata?.resultSubtype).toBe('interrupted')
  })

  test('error notification carries errorKind from codexErrorInfo', () => {
    const entry = normalize('error', {
      threadId: 't1',
      turnId: 'turn1',
      willRetry: true,
      error: { message: 'stream disconnected', codexErrorInfo: 'other' },
    })
    expect(entry!.entryType).toBe('error-message')
    expect(entry!.metadata?.willRetry).toBe(true)
    expect(entry!.metadata?.errorKind).toBe('other')
  })

  test('item/completed contextCompaction maps to system message', () => {
    const entry = normalize('item/completed', {
      threadId: 't1',
      item: { type: 'contextCompaction', id: 'cc-1' },
    })
    expect(entry).not.toBeNull()
    expect(entry!.entryType).toBe('system-message')
    expect(entry!.content).toBe('Context compacted')
  })
})
