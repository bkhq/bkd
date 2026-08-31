import { describe, expect, test } from 'bun:test'
import { ClaudeLogNormalizer } from '@/engines/executors/claude'
import type { NormalizedLogEntry } from '@/engines/types'
import './setup'

/**
 * Claude subagent observability (ENG-031).
 *
 * Envelope shapes below were captured from a real
 * `claude -p --output-format=stream-json --verbose --forward-subagent-text`
 * run that dispatched one `general-purpose` subagent.
 */

const PARENT_TOOL_USE_ID = 'toolu_01Do38k1bS3qdanEpqntrpYA'
const TASK_ID = 'ae4879875f046eada'

function parseAll(normalizer: ClaudeLogNormalizer, obj: Record<string, unknown>): NormalizedLogEntry[] {
  const result = normalizer.parse(JSON.stringify(obj))
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

function subagentMeta(entry: NormalizedLogEntry) {
  return entry.metadata?.subagent as
    | { toolCallId: string, type?: string, description?: string }
    | undefined
}

describe('subagent envelope attribution', () => {
  test('tags assistant text forwarded from a subagent', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'assistant',
      parent_tool_use_id: PARENT_TOOL_USE_ID,
      subagent_type: 'general-purpose',
      task_description: 'Read a.txt and count lines',
      session_id: 's1',
      message: {
        id: 'msg_1',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: '4' }],
      },
    })

    const text = entries.find(e => e.entryType === 'assistant-message')
    expect(text).toBeDefined()
    expect(subagentMeta(text!)).toEqual({
      toolCallId: PARENT_TOOL_USE_ID,
      type: 'general-purpose',
      description: 'Read a.txt and count lines',
    })
  })

  test('tags tool calls and thinking made inside a subagent', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'assistant',
      parent_tool_use_id: PARENT_TOOL_USE_ID,
      subagent_type: 'general-purpose',
      task_description: 'Read a.txt and count lines',
      message: {
        id: 'msg_2',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'need to read the file' },
          { type: 'tool_use', id: 'toolu_inner', name: 'Read', input: { file_path: '/tmp/a.txt' } },
        ],
      },
    })

    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(subagentMeta(entry)?.toolCallId).toBe(PARENT_TOOL_USE_ID)
    }
    const toolUse = entries.find(e => e.entryType === 'tool-use')
    expect(toolUse?.toolDetail?.toolName).toBe('Read')
  })

  test('tags tool results returned to a subagent', () => {
    const normalizer = new ClaudeLogNormalizer()
    parseAll(normalizer, {
      type: 'assistant',
      parent_tool_use_id: PARENT_TOOL_USE_ID,
      subagent_type: 'general-purpose',
      message: {
        id: 'msg_2',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_inner', name: 'Read', input: { file_path: '/tmp/a.txt' } },
        ],
      },
    })

    const entries = parseAll(normalizer, {
      type: 'user',
      parent_tool_use_id: PARENT_TOOL_USE_ID,
      subagent_type: 'general-purpose',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_inner', content: 'alpha\nbeta\ngamma' }],
      },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.metadata?.isResult).toBe(true)
    expect(subagentMeta(entries[0]!)?.toolCallId).toBe(PARENT_TOOL_USE_ID)
  })

  test('leaves main-thread messages untagged', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'assistant',
      message: { id: 'msg_3', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    })

    const text = entries.find(e => e.entryType === 'assistant-message')
    expect(text).toBeDefined()
    expect(subagentMeta(text!)).toBeUndefined()
  })

  test('does not count subagent token usage toward the issue total', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'stream_event',
      parent_tool_use_id: PARENT_TOOL_USE_ID,
      event: {
        type: 'message_delta',
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    })

    expect(entries.filter(e => e.entryType === 'token-usage')).toHaveLength(0)
  })
})

describe('subagent lifecycle events', () => {
  test('surfaces task_started with its dispatch metadata', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'system',
      subtype: 'task_started',
      task_id: TASK_ID,
      tool_use_id: PARENT_TOOL_USE_ID,
      description: 'Read a.txt and count lines',
      subagent_type: 'general-purpose',
      task_type: 'local_agent',
      prompt: 'Read the file a.txt',
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.entryType).toBe('system-message')
    expect(entries[0]!.metadata).toMatchObject({
      subtype: 'task_started',
      taskId: TASK_ID,
      toolCallId: PARENT_TOOL_USE_ID,
      subagentType: 'general-purpose',
      description: 'Read a.txt and count lines',
    })
  })

  test('surfaces task_progress with the running tool and usage', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'system',
      subtype: 'task_progress',
      task_id: TASK_ID,
      tool_use_id: PARENT_TOOL_USE_ID,
      description: 'Reading a.txt',
      subagent_type: 'general-purpose',
      last_tool_name: 'Read',
      usage: { total_tokens: 18568, tool_uses: 1, duration_ms: 2141 },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.metadata).toMatchObject({
      subtype: 'task_progress',
      taskId: TASK_ID,
      toolCallId: PARENT_TOOL_USE_ID,
      lastToolName: 'Read',
      totalTokens: 18568,
      toolUses: 1,
      durationMs: 2141,
    })
  })

  test('surfaces task_notification with the terminal status and summary', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'system',
      subtype: 'task_notification',
      task_id: TASK_ID,
      tool_use_id: PARENT_TOOL_USE_ID,
      status: 'completed',
      summary: '4',
      usage: { total_tokens: 21198, tool_uses: 1, duration_ms: 3936 },
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.metadata).toMatchObject({
      subtype: 'task_notification',
      taskId: TASK_ID,
      toolCallId: PARENT_TOOL_USE_ID,
      status: 'completed',
      summary: '4',
      totalTokens: 21198,
    })
  })

  test('suppresses redundant task bookkeeping events', () => {
    const normalizer = new ClaudeLogNormalizer()
    expect(
      parseAll(normalizer, {
        type: 'system',
        subtype: 'task_updated',
        task_id: TASK_ID,
        patch: { status: 'completed', end_time: 1787382217106 },
      }),
    ).toHaveLength(0)
  })

  test('surfaces the live background task set', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [
        { task_id: TASK_ID, task_type: 'local_agent', description: 'Count files' },
      ],
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.metadata).toMatchObject({
      subtype: 'background_tasks_changed',
      backgroundTasks: [TASK_ID],
    })
  })

  test('surfaces the drained background task set', () => {
    const normalizer = new ClaudeLogNormalizer()
    const entries = parseAll(normalizer, {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [],
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]!.metadata?.backgroundTasks).toEqual([])
  })
})
