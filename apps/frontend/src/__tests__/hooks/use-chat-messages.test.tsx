import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NormalizedLogEntry } from '@/types/kanban'
import { useChatMessages } from '@/hooks/use-chat-messages'
import issueLogsFixture from './__fixtures__/issue-8d0nfwa6-logs.json'

describe('useChatMessages — real issue 8d0nfwa6 turn 3 (refresh-loss repro)', () => {
  // User report: "为啥工具调用直接没有思考过程或者ai回复？" + "本来有的。刷新回来后就没了".
  // This fixture is the actual /api/.../logs response for that exact issue, turn
  // 3 of which is THIS conversation. DB has 3 assistant-message entries
  // (turn-3-assistant-0000/0001/0002) interleaved with tool-use action+result
  // pairs. The user said the assistant replies disappear after refresh.
  // This test renders useChatMessages on the real entries and asserts what
  // the user expects to see: 1 user message, 3 assistant messages, plus tool
  // groups in between.
  it('preserves all 3 assistant-messages in turn 3 (the messages the user says disappear)', () => {
    const all = (issueLogsFixture as {
      data: { logs: NormalizedLogEntry[] }
    }).data.logs
    const turn3 = all.filter(l => l.turnIndex === 3)

    const { result } = renderHook(() => useChatMessages(turn3))
    const types = result.current.messages.map(m => m.type)

    // DB ground truth for turn 3:
    //   1 user-message
    //   3 assistant-message (turn-3-assistant-0000, 0001, 0002)
    //   tool-groups in between
    const assistantCount = types.filter(t => t === 'assistant').length
    const userCount = types.filter(t => t === 'user').length

    expect(userCount).toBe(1)
    expect(assistantCount).toBe(3)
  })

  // The user's actual complaint: "工具调用没信息了，都不知道为什么有这个工具调用".
  // Hypothesis: commit 806eb46 changed flushToolBuffer to fire after EVERY
  // tool action so they appear in real-time during streaming. Side effect —
  // turn 3 has 12+ tool actions but ZERO get visually grouped, producing
  // 12+ standalone single-item tool cards with no preceding assistant text
  // explaining each one. The one assistant-message at the top of the turn
  // serves all 12 tools at once, so tools 2-12 look orphaned.
  it('groups adjacent tools into a single tool-group (currently produces one card per tool)', () => {
    const all = (issueLogsFixture as {
      data: { logs: NormalizedLogEntry[] }
    }).data.logs
    const turn3 = all.filter(l => l.turnIndex === 3)

    const { result } = renderHook(() => useChatMessages(turn3))
    const types = result.current.messages.map(m => m.type)
    const toolGroupCount = types.filter(t => t === 'tool-group').length

    // DB turn 3: 14 tool actions (28 tool-use entries / 2 for action+result pairs)
    // arranged in roughly 3 contiguous bursts separated by assistant messages.
    //   user → assistant-0000 → [12 tool actions] → assistant-0001
    //        → [5 tool actions] → assistant-0002
    // Visually grouped → expect 3 tool-groups (one per burst).
    // ACTUAL (after 806eb46): one group per action → ~14 groups.
    expect(toolGroupCount).toBeLessThanOrEqual(3)
  })

  // Cross-check the full issue (not just turn 3). DB has 6 assistant-message
  // entries across 5 turns and 5 user-message entries. If useChatMessages
  // drops anything globally (e.g. system-message filtering, pending bucket
  // siphoning, or commandOutputByIdx absorbing a real entry), the counts
  // here will diverge from DB ground truth and pinpoint the offender.
  it('preserves all 6 assistant + 5 user messages across the whole issue', () => {
    const all = (issueLogsFixture as {
      data: { logs: NormalizedLogEntry[] }
    }).data.logs

    const { result } = renderHook(() => useChatMessages(all))
    const { messages, pendingMessages } = result.current

    const dbAssistant = all.filter(l => l.entryType === 'assistant-message').length
    const dbUser = all.filter(l => l.entryType === 'user-message').length
    const renderedAssistant = messages.filter(m => m.type === 'assistant').length
    const renderedUser = messages.filter(m => m.type === 'user').length + pendingMessages.length

    expect({ user: renderedUser, assistant: renderedAssistant })
      .toEqual({ user: dbUser, assistant: dbAssistant })
  })
})

describe('useChatMessages — thinking + tool-group rendering', () => {
  // Regression guard for the thinking-as-description bug: long thinking text
  // used to be folded into the tool group's `description` field and rendered
  // by ToolItems.tsx:919 as a single `<span className="truncate">` line in
  // the header — visually equivalent to "thinking disappeared after refresh".
  // Now thinking always flushes as its own ThinkingChatMessage before the
  // tool group.
  it('keeps thinking as standalone message when followed by tool group', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'thinking',
        content: '让我看看这个 SQL 查询的 JOIN 条件',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
      },
      {
        entryType: 'tool-use',
        content: 'Read db/schema.ts',
        timestamp: '2026-01-01T00:00:01Z',
        turnIndex: 0,
        messageId: 't1',
        metadata: { toolCallId: 't1', isResult: false, toolName: 'Read' },
        toolDetail: { kind: 'file-read', toolName: 'Read', toolCallId: 't1', isResult: false },
      },
      {
        entryType: 'assistant-message',
        content: '问题出在 JOIN 条件上：left join 应该改成 inner join',
        timestamp: '2026-01-01T00:00:02Z',
        turnIndex: 0,
      },
    ]

    const { result } = renderHook(() => useChatMessages(logs))
    const types = result.current.messages.map(m => m.type)
    expect(types).toEqual(['thinking', 'tool-group', 'assistant'])
  })
})

describe('useChatMessages', () => {
  it('maps ACP plan system messages into task-plan messages', () => {
    const logs: NormalizedLogEntry[] = [{
      entryType: 'system-message',
      content: 'pending: Inspect repo\nin_progress: Implement ACP',
      timestamp: '2026-03-13T00:00:00.000Z',
      metadata: {
        subtype: 'plan',
        entries: [
          { content: 'Inspect repo', status: 'pending' },
          { content: 'Implement ACP', status: 'in_progress' },
        ],
      },
    }]

    const { result } = renderHook(() => useChatMessages(logs))

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toMatchObject({
      type: 'task-plan',
      completedCount: 0,
      todos: [
        { content: 'Inspect repo', status: 'pending' },
        { content: 'Implement ACP', status: 'in_progress' },
      ],
    })
  })
})
