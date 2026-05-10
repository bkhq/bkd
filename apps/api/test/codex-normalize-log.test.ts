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

    // Regression guard: the streaming `content` MUST be the chunk delta only,
    // not the cumulative accumulated text. The previous (pre-561352e) impl
    // did `this.thinkingText += delta` and emitted `content: this.thinkingText`
    // per chunk — O(N) work per chunk → O(N²) cumulative, which under
    // sustained reasoning streams produced enough GC pressure to OOM the bkd
    // process. Running the same normalizer instance across multi delta would
    // expose any regression to that pattern (cumulative emit grows; delta
    // emit stays equal to input).
    test('reasoning textDelta emits per-chunk delta, not cumulative (multi-call)', () => {
      const stateful = executor.createNormalizer()
      const out: string[] = []
      for (const delta of ['Let ', 'me ', 'think ', 'this ', 'through']) {
        const result = stateful.parse(JSON.stringify({
          method: 'item/reasoning/textDelta',
          params: { delta },
        }))
        const entry = asSingleEntry(result)
        expect(entry).not.toBeNull()
        expect(entry!.entryType).toBe('thinking')
        expect(entry!.metadata?.streaming).toBe(true)
        out.push(entry!.content)
      }
      // Each emit must equal its input chunk — NOT the cumulative accumulation.
      expect(out).toEqual(['Let ', 'me ', 'think ', 'this ', 'through'])
    })

    test('reasoning summaryTextDelta emits per-chunk delta, not cumulative (multi-call)', () => {
      const stateful = executor.createNormalizer()
      const out: string[] = []
      for (const delta of ['First ', 'point ', 'and ', 'second']) {
        const result = stateful.parse(JSON.stringify({
          method: 'item/reasoning/summaryTextDelta',
          params: { delta },
        }))
        const entry = asSingleEntry(result)
        out.push(entry!.content)
      }
      expect(out).toEqual(['First ', 'point ', 'and ', 'second'])
    })

    test('agentMessage delta emits per-chunk delta, not cumulative (multi-call)', () => {
      const stateful = executor.createNormalizer()
      const out: string[] = []
      for (const delta of ['Hello', ' ', 'world']) {
        const result = stateful.parse(JSON.stringify({
          method: 'item/agentMessage/delta',
          params: { delta },
        }))
        const entry = asSingleEntry(result)
        expect(entry!.entryType).toBe('assistant-message')
        expect(entry!.metadata?.streaming).toBe(true)
        out.push(entry!.content)
      }
      expect(out).toEqual(['Hello', ' ', 'world'])
    })

    test('plan delta emits per-chunk delta, not cumulative (multi-call)', () => {
      const stateful = executor.createNormalizer()
      const out: string[] = []
      for (const delta of ['Step 1\n', 'Step 2\n', 'Step 3']) {
        const result = stateful.parse(JSON.stringify({
          method: 'item/plan/delta',
          params: { delta },
        }))
        const entry = asSingleEntry(result)
        expect(entry!.metadata?.isPlan).toBe(true)
        out.push(entry!.content)
      }
      expect(out).toEqual(['Step 1\n', 'Step 2\n', 'Step 3'])
    })

    // Heap-bound regression guard. Under the pre-561352e O(N²) accumulator
    // pattern, processing 5000 reasoning chunks would allocate ~1.25 GB of
    // transient strings (Σ k from 1 to N of k×chunkSize), which forces V8/JSC
    // to expand its heap into the hundreds of MB. After 561352e the inner
    // loop is O(chunkSize) per call, total allocation ~500 KB → heap growth
    // is dwarfed by other test fixture overhead.
    //
    // We measure RSS rather than heapUsed: heapUsed shrinks back to near-zero
    // after `Bun.gc(true)` regardless of which version ran (transients all
    // become reclaimable), but the heap high-water-mark and OS-resident pages
    // stick around — which is exactly what eats the 10 GB OOM budget in
    // production. 100 MB threshold has a ~10× safety margin against the
    // healthy linear path while still catching the quadratic regression
    // (would balloon by hundreds of MB).
    test('5000 reasoning chunks stays under 100 MB RSS delta (O(N) regression guard)', () => {
      const N = 5000
      const CHUNK_BYTES = 100
      const chunk = 'x'.repeat(CHUNK_BYTES)

      // Warm up so the JIT and any one-time allocations don't show up
      // in the measurement window.
      const warmup = executor.createNormalizer()
      for (let i = 0; i < 200; i++) {
        warmup.parse(JSON.stringify({ method: 'item/reasoning/textDelta', params: { delta: chunk } }))
      }

      Bun.gc(true)
      const before = process.memoryUsage().rss

      const stateful = executor.createNormalizer()
      for (let i = 0; i < N; i++) {
        stateful.parse(JSON.stringify({ method: 'item/reasoning/textDelta', params: { delta: chunk } }))
      }

      Bun.gc(true)
      const delta = process.memoryUsage().rss - before
      expect(delta).toBeLessThan(100 * 1024 * 1024)
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
