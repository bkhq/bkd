import type { NormalizedLogEntry, ToolGroupChatMessage } from '@bkd/shared'
import { describe, expect, it } from 'vitest'
import { rebuildMessages } from '@/hooks/use-chat-messages'

/** Subagent nesting in the chat rebuilder (ENG-031). */

const PARENT = 'toolu_agent_1'

function entry(partial: Partial<NormalizedLogEntry> & { entryType: NormalizedLogEntry['entryType'] }): NormalizedLogEntry {
  return { content: '', ...partial }
}

function agentDispatch(): NormalizedLogEntry {
  return entry({
    entryType: 'tool-use',
    messageId: 'm1',
    content: 'Agent: research',
    metadata: { toolName: 'Agent', toolCallId: PARENT, input: { subagent_type: 'general-purpose', description: 'research' } },
    toolDetail: { kind: 'agent', toolName: 'Agent', toolCallId: PARENT, isResult: false, raw: {} },
  })
}

function subagentEntry(partial: Partial<NormalizedLogEntry> & { entryType: NormalizedLogEntry['entryType'] }): NormalizedLogEntry {
  return entry({
    ...partial,
    metadata: {
      ...partial.metadata,
      subagent: { toolCallId: PARENT, type: 'general-purpose', description: 'research' },
    },
  })
}

function firstToolGroup(messages: ReturnType<typeof rebuildMessages>): ToolGroupChatMessage {
  const group = messages.find(m => m.type === 'tool-group')
  expect(group).toBeDefined()
  return group as ToolGroupChatMessage
}

describe('rebuildMessages — subagent threads', () => {
  it('nests subagent activity under the dispatching tool call', () => {
    const messages = rebuildMessages([
      agentDispatch(),
      subagentEntry({
        entryType: 'tool-use',
        messageId: 'm2',
        content: '/tmp/a.txt',
        metadata: { toolName: 'Read', toolCallId: 'toolu_inner' },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 'toolu_inner', isResult: false, raw: {} },
      }),
      subagentEntry({
        entryType: 'tool-use',
        messageId: 'm3',
        content: 'alpha',
        metadata: { toolName: 'Read', toolCallId: 'toolu_inner', isResult: true },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 'toolu_inner', isResult: true, raw: {} },
      }),
      subagentEntry({ entryType: 'assistant-message', messageId: 'm4', content: '3 lines' }),
    ])

    const group = firstToolGroup(messages)
    expect(group.items).toHaveLength(1)
    const thread = group.items[0]!.subagent
    expect(thread).toBeDefined()
    expect(thread!.type).toBe('general-purpose')
    expect(thread!.items).toHaveLength(2)
    expect(thread!.items[0]).toMatchObject({ kind: 'tool' })
    expect(thread!.items[0]!.kind === 'tool' && thread!.items[0]!.item.result?.content).toBe('alpha')
    expect(thread!.items[1]).toMatchObject({ kind: 'text' })
  })

  it('keeps subagent turns out of the main timeline', () => {
    const messages = rebuildMessages([
      agentDispatch(),
      subagentEntry({ entryType: 'assistant-message', messageId: 'm4', content: 'inner text' }),
      entry({ entryType: 'assistant-message', messageId: 'm5', content: 'outer text' }),
    ])

    const assistantMessages = messages.filter(m => m.type === 'assistant')
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]!.entry.content).toBe('outer text')
  })

  it('folds lifecycle events into the thread status instead of the timeline', () => {
    const messages = rebuildMessages([
      agentDispatch(),
      entry({
        entryType: 'system-message',
        messageId: 'm6',
        metadata: { subtype: 'task_started', taskId: 't1', toolCallId: PARENT, subagentType: 'general-purpose', description: 'research' },
      }),
      entry({
        entryType: 'system-message',
        messageId: 'm7',
        metadata: { subtype: 'task_progress', taskId: 't1', toolCallId: PARENT, lastToolName: 'Read', totalTokens: 18568, toolUses: 1 },
      }),
      entry({
        entryType: 'system-message',
        messageId: 'm8',
        metadata: { subtype: 'task_notification', taskId: 't1', toolCallId: PARENT, status: 'completed', summary: '4', totalTokens: 21198, durationMs: 3936 },
      }),
    ])

    expect(messages.filter(m => m.type === 'system')).toHaveLength(0)

    const thread = firstToolGroup(messages).items[0]!.subagent
    expect(thread).toMatchObject({
      status: 'completed',
      lastToolName: 'Read',
      toolUses: 1,
      totalTokens: 21198,
      durationMs: 3936,
      summary: '4',
    })
  })

  it('marks a subagent still running when no terminal event arrived', () => {
    const messages = rebuildMessages([
      agentDispatch(),
      entry({
        entryType: 'system-message',
        messageId: 'm6',
        metadata: { subtype: 'task_started', taskId: 't1', toolCallId: PARENT, subagentType: 'general-purpose' },
      }),
    ])

    expect(firstToolGroup(messages).items[0]!.subagent?.status).toBe('running')
  })

  it('leaves ordinary tool calls without a thread', () => {
    const messages = rebuildMessages([
      entry({
        entryType: 'tool-use',
        messageId: 'm1',
        content: '/tmp/a.txt',
        metadata: { toolName: 'Read', toolCallId: 'toolu_plain' },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 'toolu_plain', isResult: false, raw: {} },
      }),
    ])

    expect(firstToolGroup(messages).items[0]!.subagent).toBeUndefined()
  })
})
