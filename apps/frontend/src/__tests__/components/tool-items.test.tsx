import type { NormalizedLogEntry, SubagentThread, ToolGroupChatMessage } from '@bkd/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolGroupMessage } from '@/components/issue-detail/ToolItems'
import i18n from '@/i18n'
import { useViewModeStore } from '@/stores/view-mode-store'

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
    // The body is not mounted until the panel is opened
    expect(screen.queryByText('the file has 4 lines')).not.toBeInTheDocument()

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

  it('shows subagent text and the agent result as plain text, not Markdown', () => {
    useViewModeStore.setState({ renderMarkdown: true })
    const message = group('Agent', 'agent')
    const item = message.items[0]!
    item.subagent = {
      ...thread,
      items: [{ kind: 'text', entry: { entryType: 'assistant-message', content: '**step** one', messageId: 'e1' } }],
    }
    item.result = { entryType: 'tool-use', content: '# Report\n**done**', messageId: 'r1' }
    render(<ToolGroupMessage message={message} />)

    fireEvent.click(screen.getByText('Read a.txt and count lines'))
    expect(screen.getByText('**step** one')).toBeInTheDocument()
    expect(screen.getByText(/# Report\s+\*\*done\*\*/)).toBeInTheDocument()
    useViewModeStore.setState({ renderMarkdown: false })
  })
})

describe('command tool summary', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the whole command on one line and leaves the cut to the row width', () => {
    const command = `git checkout -q -b feat/queue && sed -i 's/draft/active/' docs/plan/index.md && ${'echo step && '.repeat(10)}true`
    const action: NormalizedLogEntry = {
      entryType: 'tool-use',
      content: command,
      messageId: 'm2',
      metadata: { toolName: 'Bash', toolCallId: 'toolu_2' },
      toolAction: { kind: 'command-run', command },
      toolDetail: { kind: 'command-run', toolName: 'Bash', toolCallId: 'toolu_2', isResult: false, raw: {} },
    } as NormalizedLogEntry
    render(<ToolGroupMessage message={{ type: 'tool-group', id: 'tg-2', items: [{ action, result: null }], stats: { 'command-run': 1 }, count: 1, hiddenCount: 0 }} />)

    // No fixed character cut: CSS truncates at whatever width the row has
    const summary = screen.getByText(command)
    expect(summary.textContent).not.toContain('.....')
    expect(summary).toHaveClass('truncate', 'min-w-0')
    expect(summary).toHaveAttribute('title', command)
  })
})
