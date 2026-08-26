import type { NormalizedLogEntry, SubagentThread, ToolGroupChatMessage } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolGroupMessage } from '@/components/issue-detail/ToolItems'
import i18n from '@/i18n'

/** Subagent thread rendering (ENG-032). */

vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ resolved: 'light' }) }))

const thread: SubagentThread = {
  toolCallId: 'toolu_1',
  type: 'general-purpose',
  description: 'Read a.txt and count lines',
  status: 'completed',
  toolUses: 1,
  totalTokens: 21_326,
  summary: '4',
  items: [
    {
      kind: 'text',
      entry: { entryType: 'assistant-message', content: 'the file has 4 lines', messageId: 'e1' },
    },
  ],
}

function group(toolName: string, kind: string): ToolGroupChatMessage {
  const action: NormalizedLogEntry = {
    entryType: 'tool-use',
    content: 'dispatch',
    messageId: 'm1',
    metadata: { toolName, toolCallId: 'toolu_1', input: { subagent_type: 'general-purpose', description: 'Read a.txt and count lines' } },
    toolDetail: { kind, toolName, toolCallId: 'toolu_1', isResult: false, raw: {} },
  }
  return {
    type: 'tool-group',
    id: 'tg-1',
    items: [{ action, result: null, subagent: thread }],
    stats: { [kind]: 1 },
    count: 1,
    hiddenCount: 0,
  }
}

describe('toolGroupMessage subagent rendering', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it.each([
    ['Agent', 'agent'],
    // Older CLIs name it Task, which classifies as a generic tool
    ['Task', 'tool'],
  ])('renders the subagent thread for a %s tool call', (toolName, kind) => {
    render(<ToolGroupMessage message={group(toolName, kind)} />)

    // Collapsed state advertises the thread
    expect(screen.getByText('1 steps')).toBeInTheDocument()
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByText('Read a.txt and count lines'))
    expect(screen.getByText('Sub-agent activity')).toBeInTheDocument()
    expect(screen.getByText('the file has 4 lines')).toBeInTheDocument()
  })

  it('shows no subagent hint for an ordinary tool call', () => {
    const message = group('Read', 'file-read')
    message.items[0]!.subagent = undefined
    render(<ToolGroupMessage message={message} />)

    expect(screen.queryByText(/steps/)).not.toBeInTheDocument()
  })
})
