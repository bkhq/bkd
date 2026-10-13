import type { ChatMessage, NormalizedLogEntry } from '@bkd/shared'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTurns, mergeTurns } from '@/components/issue-detail/turn-navigator'
import { TurnNavigator } from '@/components/issue-detail/TurnNavigator'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { n?: number }) => (opts?.n ? `${key}:${opts.n}` : key) }),
}))

const entry = (entryType: NormalizedLogEntry['entryType'], content: string): NormalizedLogEntry => ({ entryType, content })
const user = (id: string, content: string): ChatMessage => ({ type: 'user', id, entry: { ...entry('user-message', content), messageId: id }, attachments: [], status: 'normal' })
const assistant = (id: string, content: string): ChatMessage => ({ type: 'assistant', id, entry: entry('assistant-message', content) })
const thinking = (id: string): ChatMessage => ({ type: 'thinking', id, entry: entry('thinking', 'hmm') })

afterEach(cleanup)

describe('buildTurns', () => {
  it('makes one turn per user message, paired with the first reply text', () => {
    const turns = buildTurns([
      user('u1', 'First question'),
      thinking('t1'),
      assistant('a1', 'First answer'),
      assistant('a2', 'Second paragraph'),
      user('u2', 'Follow-up'),
    ])
    expect(turns).toEqual([
      { index: 0, messageId: 'u1', userText: 'First question', replyText: 'First answer' },
      { index: 4, messageId: 'u2', userText: 'Follow-up', replyText: '' },
    ])
  })

  it('flattens Markdown into one line of plain text', () => {
    const [turn] = buildTurns([
      user('u1', '## Title\n\nSee **this** and `code` in [the docs](https://x.y)\n\n- item one\n> quoted'),
      assistant('a1', '```ts\nconst a = 1\n```\nDone.'),
    ])
    expect(turn.userText).toBe('Title See this and code in the docs item one quoted')
    expect(turn.replyText).toBe('ts const a = 1 Done.')
  })

  it('caps long text', () => {
    const [turn] = buildTurns([user('u1', 'x'.repeat(1000))])
    expect(turn.userText.length).toBeLessThanOrEqual(300)
  })
})

describe('mergeTurns', () => {
  it('puts unloaded server turns before the loaded ones', () => {
    const loaded = buildTurns([user('u3', 'Loaded question'), assistant('a3', 'Loaded answer')])
    const turns = mergeTurns([
      { messageId: 'u1', userText: '**Old** question', replyText: 'Old answer', entriesSince: 40 },
      { messageId: 'u3', userText: 'Loaded question', replyText: 'Loaded answer', entriesSince: 2 },
    ], loaded, 'u2')
    expect(turns).toEqual([
      { index: null, messageId: 'u1', userText: 'Old question', replyText: 'Old answer', entriesSince: 40 },
      { index: 0, messageId: 'u3', userText: 'Loaded question', replyText: 'Loaded answer' },
    ])
  })

  it('returns the loaded turns when the server list is absent', () => {
    const loaded = buildTurns([user('u3', 'Loaded question')])
    expect(mergeTurns(undefined, loaded, 'u3')).toBe(loaded)
  })
})

describe('turnNavigator', () => {
  const turns = buildTurns([
    user('u1', 'First question'),
    assistant('a1', 'First answer'),
    user('u2', 'Second question'),
    assistant('a2', 'Second answer'),
  ])

  it('renders nothing with fewer than two turns', () => {
    const { container } = render(<TurnNavigator turns={turns.slice(0, 1)} activeIndex={0} onJump={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders one tick per turn and marks the active one', () => {
    render(<TurnNavigator turns={turns} activeIndex={2} onJump={vi.fn()} />)
    const ticks = screen.getAllByRole('button')
    expect(ticks).toHaveLength(2)
    expect(ticks[0]).toHaveAttribute('aria-label', 'session.jumpToTurn:1')
    expect(ticks[0]).not.toHaveAttribute('aria-current')
    expect(ticks[1]).toHaveAttribute('aria-current', 'true')
  })

  it('previews the turn on hover', () => {
    render(<TurnNavigator turns={turns} activeIndex={0} onJump={vi.fn()} />)
    expect(screen.queryByText('Second question')).toBeNull()
    fireEvent.mouseEnter(screen.getAllByRole('button')[1])
    expect(screen.getByText('Second question')).toBeInTheDocument()
    expect(screen.getByText('Second answer')).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getAllByRole('button')[1])
    expect(screen.queryByText('Second question')).toBeNull()
  })

  it('jumps to the turn message on click', () => {
    const onJump = vi.fn()
    render(<TurnNavigator turns={turns} activeIndex={0} onJump={onJump} />)
    fireEvent.click(screen.getAllByRole('button')[1])
    expect(onJump).toHaveBeenCalledWith(turns[1])
  })

  const unloaded = { index: null, messageId: 'u0', userText: 'Old question', replyText: 'Old answer', entriesSince: 1500 }

  it('asks before a jump that loads a lot of history', () => {
    const onJump = vi.fn()
    render(<TurnNavigator turns={[unloaded, ...turns]} activeIndex={0} loadedEntries={100} onJump={onJump} />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onJump).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'session.loadHistoryConfirm' }))
    expect(onJump).toHaveBeenCalledWith(unloaded)
  })

  it('jumps straight to a nearby unloaded turn', () => {
    const onJump = vi.fn()
    render(<TurnNavigator turns={[{ ...unloaded, entriesSince: 300 }, ...turns]} activeIndex={0} loadedEntries={100} onJump={onJump} />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(onJump).toHaveBeenCalledWith({ ...unloaded, entriesSince: 300 })
  })
})
