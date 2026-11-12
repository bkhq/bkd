import type { NormalizedLogEntry, ToolGroupChatMessage } from '@bkd/shared'
import { describe, expect, it } from 'vitest'
import { ChatMessageBuilder, rebuildMessages } from '@/hooks/use-chat-messages'

/** Subagent nesting in the chat rebuilder. */

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

  it('leaves a background Bash call without a thread despite its task events', () => {
    const callId = 'toolu_bg_bash'
    const messages = rebuildMessages([
      entry({
        entryType: 'tool-use',
        messageId: 'm1',
        content: 'bun t.ts',
        metadata: { toolName: 'Bash', toolCallId: callId },
        toolDetail: { kind: 'command-run', toolName: 'Bash', toolCallId: callId, isResult: false, raw: {} },
      }),
      entry({
        entryType: 'system-message',
        messageId: 'm2',
        metadata: { subtype: 'task_started', taskId: 'b1', toolCallId: callId },
      }),
      entry({
        entryType: 'system-message',
        messageId: 'm3',
        metadata: { subtype: 'task_notification', taskId: 'b1', toolCallId: callId, status: 'completed' },
      }),
      entry({
        entryType: 'tool-use',
        messageId: 'm4',
        content: '{"peakRssMB":68}',
        metadata: { toolName: 'Bash', toolCallId: callId, isResult: true },
        toolDetail: { kind: 'other', toolName: 'Bash', toolCallId: callId, isResult: true, raw: {} },
      }),
    ])

    expect(firstToolGroup(messages).items[0]!.subagent).toBeUndefined()
  })
})

describe('rebuildMessages — failed tool results', () => {
  const bashCall = entry({
    entryType: 'tool-use',
    messageId: 'm1',
    content: 'git diff --exit-code',
    metadata: { toolName: 'Bash', toolCallId: 'toolu_bash' },
    toolDetail: { kind: 'command-run', toolName: 'Bash', toolCallId: 'toolu_bash', isResult: false, raw: {} },
  })

  it('pairs a failed result with its tool call instead of raising an error message', () => {
    const failed = entry({
      entryType: 'error-message',
      messageId: 'm2',
      content: 'Exit code 1\ndiff --git a/a.ts b/a.ts',
      metadata: { toolName: 'Bash', toolCallId: 'toolu_bash', isResult: true },
    })

    const messages = rebuildMessages([bashCall, failed])

    expect(messages.filter(m => m.type === 'error')).toHaveLength(0)
    expect(firstToolGroup(messages).items[0]!.result).toBe(failed)
  })

  it('keeps an error that is not a tool result as an error message', () => {
    const messages = rebuildMessages([
      bashCall,
      entry({ entryType: 'error-message', messageId: 'm2', content: 'Turn failed' }),
    ])

    expect(messages.filter(m => m.type === 'error')).toHaveLength(1)
    expect(firstToolGroup(messages).items[0]!.result).toBeNull()
  })
})

describe('chatMessageBuilder', () => {
  /** Deterministic pseudo-random numbers, so a failure can be replayed. */
  function rng(seed: number) {
    let state = seed
    return (n: number) => {
      state = (state * 1103515245 + 12345) & 0x7FFFFFFF
      return state % n
    }
  }

  function generate(seed: number, count: number): NormalizedLogEntry[] {
    const next = rng(seed)
    const out: NormalizedLogEntry[] = []
    let id = 0
    let turn = 0
    const openCalls: string[] = []
    const agentCalls: string[] = []
    const push = (entry: Omit<NormalizedLogEntry, 'messageId'>, withId = true) => {
      id++
      out.push({ ...entry, ...(withId ? { messageId: `m${String(id).padStart(6, '0')}` } : {}) } as NormalizedLogEntry)
    }
    while (out.length < count) {
      switch (next(14)) {
        case 0:
          turn++
          push({ entryType: 'user-message', content: `ask ${id}`, turnIndex: turn }, next(5) > 0)
          break
        case 1:
          push({ entryType: 'assistant-message', content: `answer ${id}`, turnIndex: turn }, next(5) > 0)
          break
        case 2:
        case 3: {
          const callId = `call-${id}`
          const agent = next(4) === 0
          push({
            entryType: 'tool-use',
            content: '',
            turnIndex: turn,
            toolDetail: { kind: agent ? 'agent' : 'command', toolName: agent ? 'Agent' : 'Bash', toolCallId: callId, isResult: false },
          })
          openCalls.push(callId)
          if (agent) agentCalls.push(callId)
          break
        }
        case 4:
        case 5: {
          const callId = openCalls.length > 0 && next(4) > 0 ? openCalls.splice(next(openCalls.length), 1)[0] : `orphan-${id}`
          push({
            entryType: next(6) === 0 ? 'error-message' : 'tool-use',
            content: 'out',
            turnIndex: turn,
            toolDetail: { kind: 'command', toolName: 'Bash', toolCallId: callId, isResult: true },
          })
          break
        }
        case 6:
          push({ entryType: 'thinking', content: next(4) === 0 ? '' : `thought ${id}`, turnIndex: turn })
          break
        case 7:
          push({ entryType: 'system-message', content: 'done', turnIndex: next(3) === 0 ? Math.max(0, turn - 1) : turn, metadata: { duration: 1000 + id } })
          break
        case 8:
          push({ entryType: 'error-message', content: 'boom', turnIndex: turn })
          break
        case 9:
          if (agentCalls.length > 0) {
            const toolCallId = agentCalls[next(agentCalls.length)]
            push({ entryType: 'assistant-message', content: `inner ${id}`, turnIndex: turn, metadata: { subagent: { toolCallId, type: 'Explore' } } })
          }
          break
        case 10:
          if (agentCalls.length > 0) {
            const toolCallId = agentCalls[next(agentCalls.length)]
            const subtype = ['task_started', 'task_progress', 'task_notification'][next(3)]
            push({ entryType: 'system-message', content: '', turnIndex: turn, metadata: { subtype, toolCallId, status: 'completed', toolUses: id } })
          }
          break
        case 11:
          turn++
          push({ entryType: 'user-message', content: '/compact', turnIndex: turn, metadata: { type: 'command' } })
          break
        case 12:
          push({ entryType: 'system-message', content: 'compacted', turnIndex: turn, metadata: { subtype: 'command_output' } })
          break
        default:
          push({
            entryType: 'tool-use',
            content: '',
            turnIndex: turn,
            toolDetail: { kind: 'other', toolName: 'TodoWrite', toolCallId: `todo-${id}`, isResult: false },
            metadata: { toolName: 'TodoWrite', input: { todos: [{ content: `step ${id}`, status: 'pending' }] } },
          })
      }
    }
    return out
  }

  it('matches a full rebuild while the list is appended to, prepended to, edited and trimmed', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const next = rng(seed * 7919)
      const all = generate(seed, 220)
      const builder = new ChatMessageBuilder()
      let from = 60
      let to = 80
      let list = all.slice(from, to)
      for (let step = 0; step < 60; step++) {
        switch (next(8)) {
          case 0: {
            // older page loaded
            const take = Math.min(from, 1 + next(15))
            from -= take
            list = [...all.slice(from, from + take), ...list]
            break
          }
          case 1:
            // an entry is replaced by an updated copy
            if (list.length > 0) {
              const at = next(list.length)
              list = list.map((e, i) => (i === at ? { ...e, content: `${e.content}!` } : e))
            }
            break
          case 2:
            // an entry is removed (recalled message, live trim)
            if (list.length > 1) {
              const at = next(list.length)
              list = list.filter((_, i) => i !== at)
            }
            break
          default: {
            const take = Math.min(all.length - to, 1 + next(4))
            list = [...list, ...all.slice(to, to + take)]
            to += take
          }
        }
        expect(builder.update(list), `seed ${seed} step ${step}`).toEqual(rebuildMessages(list))
      }
    }
  })

  it('keeps the message objects before the last checkpoint when entries are appended', () => {
    const entries: NormalizedLogEntry[] = [
      { messageId: 'a1', entryType: 'user-message', content: 'one', turnIndex: 1 },
      { messageId: 'a2', entryType: 'assistant-message', content: 'reply one', turnIndex: 1 },
      { messageId: 'a3', entryType: 'user-message', content: 'two', turnIndex: 2 },
      { messageId: 'a4', entryType: 'assistant-message', content: 'reply two', turnIndex: 2 },
    ]
    const builder = new ChatMessageBuilder()
    const before = builder.update(entries)
    const after = builder.update([
      ...entries,
      { messageId: 'a5', entryType: 'user-message', content: 'three', turnIndex: 3 },
    ])

    expect(after).toHaveLength(5)
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
  })

  it('regroups from the tool call when its result arrives later', () => {
    const call: NormalizedLogEntry = {
      messageId: 'b2',
      entryType: 'tool-use',
      content: '',
      turnIndex: 1,
      toolDetail: { kind: 'command', toolName: 'Bash', toolCallId: 'c1', isResult: false },
    }
    const entries: NormalizedLogEntry[] = [
      { messageId: 'b1', entryType: 'user-message', content: 'run it', turnIndex: 1 },
      call,
      { messageId: 'b3', entryType: 'assistant-message', content: 'started', turnIndex: 1 },
    ]
    const builder = new ChatMessageBuilder()
    builder.update(entries)
    const withResult = [
      ...entries,
      { messageId: 'b4', entryType: 'tool-use', content: 'ok', turnIndex: 1, toolDetail: { kind: 'command', toolName: 'Bash', toolCallId: 'c1', isResult: true } } as NormalizedLogEntry,
    ]

    const messages = builder.update(withResult)
    expect(messages).toEqual(rebuildMessages(withResult))
    expect(firstToolGroup(messages).items[0]!.result?.messageId).toBe('b4')
  })
})
