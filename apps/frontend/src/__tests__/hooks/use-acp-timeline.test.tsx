import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NormalizedLogEntry } from '@/types/kanban'
import { useAcpTimeline } from '@/hooks/use-acp-timeline'

describe('useAcpTimeline', () => {
  it('maps ACP plans and paired tool calls into grouped ACP timeline items', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'user-message',
        content: 'internal smoke prompt',
        metadata: { type: 'system' },
      },
      {
        entryType: 'system-message',
        content: 'pending: Inspect repo',
        metadata: {
          subtype: 'plan',
          entries: [
            { content: 'Inspect repo', status: 'pending' },
            { content: 'Implement renderer', status: 'in_progress' },
          ],
        },
      },
      {
        messageId: 'tool-action-1',
        entryType: 'tool-use',
        content: 'List project files',
        metadata: {
          toolCallId: 'tool-1',
          toolName: 'List project files',
          kind: 'execute',
        },
        toolAction: {
          kind: 'command-run',
          command: 'find . -maxdepth 1 -type f | sort',
        },
        toolDetail: {
          kind: 'command-run',
          toolName: 'List project files',
          toolCallId: 'tool-1',
          isResult: false,
        },
      },
      {
        messageId: 'tool-result-1',
        entryType: 'tool-use',
        content: './package.json\n./tsconfig.json',
        metadata: {
          toolCallId: 'tool-1',
          toolName: 'List project files',
          kind: 'execute',
          isResult: true,
        },
        toolDetail: {
          kind: 'command-run',
          toolName: 'List project files',
          toolCallId: 'tool-1',
          isResult: true,
        },
      },
      {
        entryType: 'assistant-message',
        content: 'Done.',
      },
    ]

    const { result } = renderHook(() => useAcpTimeline(logs))

    expect(result.current.pendingMessages).toHaveLength(0)
    expect(result.current.items).toHaveLength(3)
    expect(result.current.items[0]).toMatchObject({
      type: 'plan',
      completedCount: 0,
      todos: [
        { content: 'Inspect repo', status: 'pending' },
        { content: 'Implement renderer', status: 'in_progress' },
      ],
    })
    expect(result.current.items[1]).toMatchObject({
      type: 'tool-group',
      message: {
        count: 1,
        items: [
          {
            action: {
              messageId: 'tool-action-1',
              content: 'List project files',
            },
            result: {
              messageId: 'tool-result-1',
              content: './package.json\n./tsconfig.json',
            },
          },
        ],
      },
    })
    expect(result.current.items[2]).toMatchObject({
      type: 'entry',
      entry: {
        entryType: 'assistant-message',
        content: 'Done.',
      },
    })
  })

  it('merges streaming ACP assistant chunks until final assistant message arrives', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'assistant-message',
        content: 'Hello ',
        turnIndex: 3,
        metadata: { streaming: true },
      },
      {
        entryType: 'assistant-message',
        content: 'world',
        turnIndex: 3,
        metadata: { streaming: true },
      },
      {
        messageId: 'assistant-final-3',
        entryType: 'assistant-message',
        content: 'Hello world',
        turnIndex: 3,
      },
    ]

    const { result } = renderHook(() => useAcpTimeline(logs))

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0]).toMatchObject({
      type: 'entry',
      entry: {
        entryType: 'assistant-message',
        content: 'Hello world',
      },
    })
  })

  it('groups consecutive ACP tool calls into a single tool-group', () => {
    const logs: NormalizedLogEntry[] = [
      {
        messageId: 'tool-action-1',
        entryType: 'tool-use',
        content: 'List files',
        metadata: { toolCallId: 'tool-1', toolName: 'List files' },
        toolAction: { kind: 'command-run', command: 'find . -maxdepth 1 -type f' },
        toolDetail: { kind: 'command-run', toolName: 'List files', toolCallId: 'tool-1', isResult: false },
      },
      {
        messageId: 'tool-result-1',
        entryType: 'tool-use',
        content: './package.json',
        metadata: { toolCallId: 'tool-1', toolName: 'List files', isResult: true },
        toolDetail: { kind: 'command-run', toolName: 'List files', toolCallId: 'tool-1', isResult: true },
      },
      {
        messageId: 'tool-action-2',
        entryType: 'tool-use',
        content: 'Read package.json',
        metadata: { toolCallId: 'tool-2', toolName: 'Read package.json' },
        toolAction: { kind: 'file-read', path: 'package.json' },
        toolDetail: { kind: 'file-read', toolName: 'Read package.json', toolCallId: 'tool-2', isResult: false },
      },
      {
        messageId: 'tool-result-2',
        entryType: 'tool-use',
        content: '{"name":"demo"}',
        metadata: { toolCallId: 'tool-2', toolName: 'Read package.json', isResult: true },
        toolDetail: { kind: 'file-read', toolName: 'Read package.json', toolCallId: 'tool-2', isResult: true },
      },
      {
        messageId: 'assistant-final-1',
        entryType: 'assistant-message',
        content: 'Done.',
      },
    ]

    const { result } = renderHook(() => useAcpTimeline(logs))

    expect(result.current.items).toHaveLength(2)
    expect(result.current.items[0]).toMatchObject({
      type: 'tool-group',
      message: {
        count: 2,
        items: [
          {
            action: { messageId: 'tool-action-1' },
            result: { messageId: 'tool-result-1' },
          },
          {
            action: { messageId: 'tool-action-2' },
            result: { messageId: 'tool-result-2' },
          },
        ],
      },
    })
    expect(result.current.items[1]).toMatchObject({
      type: 'entry',
      entry: { entryType: 'assistant-message', content: 'Done.' },
    })
  })
})
