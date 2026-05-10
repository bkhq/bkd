import { describe, expect, test } from 'bun:test'
import { parseAcpModel, toScopedAcpModelId } from '@/engines/executors/acp/agents'
import { AcpLogNormalizer, normalizeAcpEvent } from '@/engines/executors/acp/acp-client'

describe('normalizeAcpEvent', () => {
  test('maps assistant chunks to streaming assistant messages', () => {
    const result = normalizeAcpEvent(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'hello from acp',
        },
      },
    }))

    expect(result).toBeTruthy()
    const entries = Array.isArray(result) ? result : [result]
    expect(entries[0]?.entryType).toBe('assistant-message')
    expect(entries[0]?.content).toBe('hello from acp')
    expect(entries[0]?.metadata?.streaming).toBe(true)
  })

  test('marks prompt result as a turn completion entry', () => {
    const result = normalizeAcpEvent(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'end_turn',
      durationMs: 42,
    }))

    expect(result).toBeTruthy()
    const entries = Array.isArray(result) ? result : [result]
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entryType).toBe('system-message')
    expect(entries[0]?.metadata?.turnCompleted).toBe(true)
    expect(entries[0]?.metadata?.resultSubtype).toBe('success')
  })

  test('marks prompt failures as logical failures', () => {
    const result = normalizeAcpEvent(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'error',
      error: 'quota exhausted',
    }))

    expect(result).toBeTruthy()
    const entries = Array.isArray(result) ? result : [result]
    expect(entries[0]?.metadata?.turnCompleted).toBe(true)
    expect(entries[0]?.metadata?.resultSubtype).toBe('error')
    expect(entries[0]?.metadata?.isError).toBe(true)
  })
})

describe('AcpLogNormalizer', () => {
  test('flushes a final assistant message before turn completion', () => {
    const normalizer = new AcpLogNormalizer()

    const chunk = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'hello from acp',
        },
      },
    }))

    expect(chunk).toBeTruthy()
    expect(Array.isArray(chunk)).toBe(false)
    expect((chunk as { metadata?: Record<string, unknown> })?.metadata?.streaming).toBe(true)

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'end_turn',
      durationMs: 42,
    }))

    expect(Array.isArray(result)).toBe(true)
    const entries = result as Array<{ entryType: string, content: string, metadata?: Record<string, unknown> }>
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      entryType: 'assistant-message',
      content: 'hello from acp',
    })
    expect(entries[0]?.metadata?.streaming).toBeUndefined()
    // Regression (CHAT-003): the flushed final-content entry must carry
    // `dbOnly: true` so the timeline-emit pipeline stage skips it. Without
    // this flag it re-enters `liveConverter.ingest` and opens a duplicate
    // assistant segment next to the streaming buffer that already holds the
    // same content — producing two visible bubbles per turn for OpenCode.
    expect(entries[0]?.metadata?.dbOnly).toBe(true)
    expect(entries[1]?.entryType).toBe('system-message')
    expect(entries[1]?.metadata?.turnCompleted).toBe(true)
    // The closing system-message must NOT be dbOnly — it's the natural turn
    // boundary the timeline-converter relies on to close any open buffers.
    expect(entries[1]?.metadata?.dbOnly).toBeUndefined()
  })

  test('flushes thinking and assistant with dbOnly:true on turn completion (CHAT-003)', () => {
    const normalizer = new AcpLogNormalizer()

    // OpenCode-style interleave: thinking → assistant → thinking → assistant.
    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-05-10T00:00:00.000Z',
      update: { sessionUpdate: 'agent_thought_chunk', content: { text: 'thinking part 1' } },
    }))
    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-05-10T00:00:00.100Z',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '1. step one\n' } },
    }))
    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-05-10T00:00:00.200Z',
      update: { sessionUpdate: 'agent_thought_chunk', content: { text: ' thinking part 2' } },
    }))
    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-05-10T00:00:00.300Z',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '2. step two' } },
    }))

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-05-10T00:00:00.400Z',
      stopReason: 'end_turn',
    }))

    expect(Array.isArray(result)).toBe(true)
    const entries = result as Array<{
      entryType: string
      content: string
      metadata?: Record<string, unknown>
    }>
    // [thinking-flush, assistant-flush, system-message]
    expect(entries).toHaveLength(3)

    const thinking = entries.find(e => e.entryType === 'thinking')
    const assistant = entries.find(e => e.entryType === 'assistant-message')
    const system = entries.find(e => e.entryType === 'system-message')

    // Both thinking + assistant flush entries must be dbOnly so they land
    // in the DB but skip the live timeline (which already has the streaming
    // buffer's content).
    expect(thinking?.metadata?.dbOnly).toBe(true)
    expect(assistant?.metadata?.dbOnly).toBe(true)
    expect(system?.metadata?.dbOnly).toBeUndefined()

    // Merged content covers the whole turn, not just one segment.
    expect(thinking?.content).toBe('thinking part 1 thinking part 2')
    expect(assistant?.content).toBe('1. step one\n2. step two')
  })

  test('pairs tool call actions with terminal results', () => {
    const normalizer = new AcpLogNormalizer()

    const action = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read src/app.ts',
        kind: 'read',
        status: 'in_progress',
        rawInput: { path: 'src/app.ts' },
        locations: [{ path: 'src/app.ts', line: 12 }],
      },
    }))

    expect(Array.isArray(action)).toBe(false)
    expect(action).toMatchObject({
      entryType: 'tool-use',
      content: 'Read src/app.ts',
      metadata: {
        toolCallId: 'tool-1',
        toolName: 'Read src/app.ts',
        status: 'in_progress',
        kind: 'read',
      },
      toolDetail: {
        kind: 'file-read',
        toolCallId: 'tool-1',
        isResult: false,
      },
      toolAction: {
        kind: 'file-read',
        path: 'src/app.ts',
      },
    })

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: { text: 'file contents' },
      },
    }))

    expect(Array.isArray(result)).toBe(false)
    expect(result).toMatchObject({
      entryType: 'tool-use',
      content: 'file contents',
      metadata: {
        toolCallId: 'tool-1',
        toolName: 'Read src/app.ts',
        status: 'completed',
        kind: 'read',
        isResult: true,
      },
      toolDetail: {
        kind: 'file-read',
        toolCallId: 'tool-1',
        isResult: true,
      },
    })
  })

  test('does not emit duplicate placeholder and specialized actions for the same tool call', () => {
    const normalizer = new AcpLogNormalizer()

    const placeholder = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-read-1',
        title: 'Read File',
      },
    }))

    expect(placeholder).toBeNull()

    const specialized = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.500Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-read-1',
        title: 'Read File',
        kind: 'read',
        locations: [{ path: '/app/test/acp/docs/task/API-001.md', line: 1 }],
      },
    }))

    expect(Array.isArray(specialized)).toBe(false)
    expect(specialized).toMatchObject({
      entryType: 'tool-use',
      toolDetail: {
        toolCallId: 'tool-read-1',
        kind: 'file-read',
        isResult: false,
      },
      toolAction: {
        kind: 'file-read',
        path: '/app/test/acp/docs/task/API-001.md',
      },
    })

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-read-1',
        status: 'completed',
        rawOutput: {
          formatted_output: '# API-001\\n\\n- **status**: completed',
        },
      },
    }))

    expect(Array.isArray(result)).toBe(false)
    expect(result).toMatchObject({
      entryType: 'tool-use',
      toolDetail: {
        toolCallId: 'tool-read-1',
        isResult: true,
      },
    })
  })

  test('prefers formatted tool output text over raw json output', () => {
    const normalizer = new AcpLogNormalizer()

    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-3',
        title: 'List PMA skill files',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: 'find /root/.agents/skills/pma -maxdepth 2 -type f | sort' },
      },
    }))

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-3',
        status: 'completed',
        rawOutput: {
          stdout: '/tmp/a\n/tmp/b\n',
          formatted_output: '/root/.agents/skills/pma/SKILL.md\n/root/.agents/skills/pma/docs/plan-format.md\n',
          aggregated_output: '/tmp/a\n/tmp/b\n',
          exit_code: 0,
        },
      },
    }))

    expect(Array.isArray(result)).toBe(false)
    expect(result).toMatchObject({
      entryType: 'tool-use',
      content: '/root/.agents/skills/pma/SKILL.md\n/root/.agents/skills/pma/docs/plan-format.md',
      metadata: {
        toolCallId: 'tool-3',
        toolName: 'List PMA skill files',
        status: 'completed',
        kind: 'execute',
        isResult: true,
      },
      toolDetail: {
        kind: 'command-run',
        toolCallId: 'tool-3',
        isResult: true,
      },
    })
  })

  test('flushes outstanding tool results at prompt completion', () => {
    const normalizer = new AcpLogNormalizer()

    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-2',
        title: 'Search workspace',
        kind: 'search',
        rawInput: { query: 'acp-client' },
      },
    }))

    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.500Z',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-2',
        status: 'in_progress',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'found 3 matches',
            },
          },
        ],
      },
    }))

    const result = normalizer.parse(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'end_turn',
      durationMs: 42,
    }))

    expect(Array.isArray(result)).toBe(true)
    const entries = result as Array<{ entryType: string, content: string, metadata?: Record<string, unknown> }>
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      entryType: 'tool-use',
      content: 'found 3 matches',
      metadata: {
        toolCallId: 'tool-2',
        toolName: 'Search workspace',
        isResult: true,
      },
    })
    expect(entries[1]?.entryType).toBe('system-message')
    expect(entries[1]?.metadata?.turnCompleted).toBe(true)
  })

  test('streams thinking chunks in real-time', () => {
    const normalizer = new AcpLogNormalizer()

    const chunk1 = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: 'I need to',
      },
    }))

    expect(chunk1).toBeTruthy()
    expect(Array.isArray(chunk1)).toBe(false)
    expect(chunk1).toMatchObject({
      entryType: 'thinking',
      content: 'I need to',
      metadata: { streaming: true },
    })

    const chunk2 = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: 'I need to analyze the codebase',
      },
    }))

    expect(chunk2).toMatchObject({
      entryType: 'thinking',
      content: 'I need to analyze the codebase',
      metadata: { streaming: true },
    })
  })

  test('handles incremental thinking deltas', () => {
    const normalizer = new AcpLogNormalizer()

    // The streaming `content` is the chunk text verbatim (not the cumulative
    // accumulation) — accumulation is the live converter's job downstream
    // and the normalizer-side flush's job at turn end. This keeps per-chunk
    // work O(chunk_size) instead of O(cumulative_size).
    const chunk1 = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { text: 'Let me' },
      },
    }))
    expect(chunk1).toMatchObject({
      entryType: 'thinking',
      content: 'Let me',
      metadata: { streaming: true },
    })

    const chunk2 = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { text: ' check the imports' },
      },
    }))
    expect(chunk2).toMatchObject({
      entryType: 'thinking',
      content: ' check the imports',
      metadata: { streaming: true },
    })

    const chunk3 = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:02.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { text: ' and fix the types' },
      },
    }))
    expect(chunk3).toMatchObject({
      entryType: 'thinking',
      content: ' and fix the types',
      metadata: { streaming: true },
    })

    // Final flush concatenates deltas correctly.
    const result = normalizer.parse(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:03.000Z',
      stopReason: 'end_turn',
    }))
    const entries = result as Array<{ entryType: string, content: string, metadata?: Record<string, unknown> }>
    const thinkingEntry = entries.find(e => e.entryType === 'thinking')
    expect(thinkingEntry?.content).toBe('Let me check the imports and fix the types')
    expect(thinkingEntry?.metadata?.streaming).toBeUndefined()
  })

  test('handles full-content thinking chunks (startsWith)', () => {
    const normalizer = new AcpLogNormalizer()

    // Agent sends full accumulated text each time
    const chunk1 = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: 'Thinking about',
      },
    }))
    expect(chunk1).toMatchObject({
      entryType: 'thinking',
      content: 'Thinking about',
      metadata: { streaming: true },
    })

    // Next chunk contains the full accumulated text
    const chunk2 = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: 'Thinking about the problem',
      },
    }))
    expect(chunk2).toMatchObject({
      entryType: 'thinking',
      content: 'Thinking about the problem',
      metadata: { streaming: true },
    })

    // Verify no duplication (should not be "Thinking aboutThinking about the problem")
    expect(chunk2!.content).toBe('Thinking about the problem')
  })

  test('flushes final thinking on prompt result after streaming', () => {
    const normalizer = new AcpLogNormalizer()

    // Streaming thinking during the turn
    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: 'Analyzing requirements',
      },
    }))

    normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:01.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: ' and planning the solution',
      },
    }))

    // Turn completes — flushes final thinking + assistant + system
    const result = normalizer.parse(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:02.000Z',
      stopReason: 'end_turn',
      durationMs: 42,
    }))

    expect(Array.isArray(result)).toBe(true)
    const entries = result as Array<{ entryType: string, content: string, metadata?: Record<string, unknown> }>

    // Should contain the flushed thinking entry
    const thinkingEntry = entries.find(e => e.entryType === 'thinking')
    expect(thinkingEntry).toBeTruthy()
    expect(thinkingEntry!.content).toBe('Analyzing requirements and planning the solution')
    expect(thinkingEntry!.metadata?.streaming).toBeUndefined()

    // Should also contain turn completion
    const completionEntry = entries.find(e => e.entryType === 'system-message')
    expect(completionEntry).toBeTruthy()
    expect(completionEntry!.metadata?.turnCompleted).toBe(true)
  })

  test('handles non-text thinking content (JSON fallback)', () => {
    const normalizer = new AcpLogNormalizer()

    const chunk = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { reasoning: 'deep', steps: 3 },
      },
    }))

    expect(chunk).toBeTruthy()
    expect(chunk).toMatchObject({
      entryType: 'thinking',
      content: JSON.stringify({ reasoning: 'deep', steps: 3 }),
      metadata: { streaming: true },
    })
  })

  test('ignores empty thinking chunks', () => {
    const normalizer = new AcpLogNormalizer()

    const chunk = normalizer.parse(JSON.stringify({
      type: 'acp-session-update',
      timestamp: '2026-03-13T00:00:00.000Z',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: '',
      },
    }))

    expect(chunk).toBeTruthy()
    expect(chunk).toMatchObject({
      entryType: 'thinking',
      content: '',
      metadata: { streaming: true },
    })

    // Prompt result should not emit an empty thinking entry
    const result = normalizer.parse(JSON.stringify({
      type: 'acp-prompt-result',
      timestamp: '2026-03-13T00:00:01.000Z',
      stopReason: 'end_turn',
    }))

    expect(Array.isArray(result)).toBe(true)
    const entries = result as Array<{ entryType: string }>
    const thinkingEntries = entries.filter(e => e.entryType === 'thinking')
    expect(thinkingEntries).toHaveLength(0)
  })

  // Heap-bound regression guard. The pre-596bf4a `agent_thought_chunk` handler
  // computed `state.thinkingTextParts.join('')` twice and `startsWith` once
  // per chunk — O(N) per chunk → O(N²) cumulative. With 5000 chunks that
  // produces ~1.25 GB of transient string allocations, ballooning V8/JSC heap
  // and OS-resident pages into the hundreds of MB. After 596bf4a the inner
  // loop just pushes the chunk into the parts array (O(chunkSize)) and emits
  // the chunk text verbatim, so total allocation stays in the low MB.
  //
  // RSS rather than heapUsed because heapUsed can shrink near-zero after
  // `Bun.gc(true)` regardless of allocation history; what matters for the
  // OOM scenario is the heap high-water-mark / RSS, which sticks around. A
  // 100 MB threshold catches the quadratic regression with ~10× safety
  // margin against healthy linear behavior + concurrent test fixture noise.
  test('5000 thought chunks stays under 100 MB RSS delta (O(N) regression guard)', () => {
    const N = 5000
    const CHUNK_BYTES = 100
    const chunkText = 'y'.repeat(CHUNK_BYTES)

    // Warm up the JIT so first-call costs don't pollute the measurement.
    const warmup = new AcpLogNormalizer()
    for (let i = 0; i < 200; i++) {
      warmup.parse(JSON.stringify({
        type: 'acp-session-update',
        timestamp: '2026-03-13T00:00:00.000Z',
        update: { sessionUpdate: 'agent_thought_chunk', content: chunkText },
      }))
    }

    Bun.gc(true)
    const before = process.memoryUsage().rss

    const normalizer = new AcpLogNormalizer()
    for (let i = 0; i < N; i++) {
      normalizer.parse(JSON.stringify({
        type: 'acp-session-update',
        timestamp: '2026-03-13T00:00:00.000Z',
        update: { sessionUpdate: 'agent_thought_chunk', content: chunkText },
      }))
    }

    Bun.gc(true)
    const delta = process.memoryUsage().rss - before
    expect(delta).toBeLessThan(100 * 1024 * 1024)
  })
})

describe('parseAcpModel', () => {
  test('parses scoped gemini model ids', () => {
    expect(parseAcpModel('acp:gemini:gemini-2.5-pro')).toEqual({
      agentId: 'gemini',
      modelId: 'gemini-2.5-pro',
      raw: 'acp:gemini:gemini-2.5-pro',
      scoped: true,
    })
  })

  test('parses scoped codex model ids', () => {
    expect(parseAcpModel('acp:codex:gpt-5.4')).toEqual({
      agentId: 'codex',
      modelId: 'gpt-5.4',
      raw: 'acp:codex:gpt-5.4',
      scoped: true,
    })
  })

  test('parses scoped claude model ids', () => {
    expect(parseAcpModel('acp:claude:claude-sonnet-4-6')).toEqual({
      agentId: 'claude',
      modelId: 'claude-sonnet-4-6',
      raw: 'acp:claude:claude-sonnet-4-6',
      scoped: true,
    })
  })

  test('keeps legacy plain models on default gemini agent', () => {
    expect(parseAcpModel('gemini-2.5-flash')).toEqual({
      agentId: 'gemini',
      modelId: 'gemini-2.5-flash',
      raw: 'gemini-2.5-flash',
      scoped: false,
    })
  })

  test('formats scoped ids consistently', () => {
    expect(toScopedAcpModelId('codex', 'gpt-5.4')).toBe('acp:codex:gpt-5.4')
  })
})
