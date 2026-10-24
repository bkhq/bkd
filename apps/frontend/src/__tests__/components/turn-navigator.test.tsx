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

  it('skips queued, done and system user rows, like the server turn list', () => {
    const withMeta = (id: string, metadata: Record<string, unknown>): ChatMessage => {
      const message = user(id, id) as Extract<ChatMessage, { type: 'user' }>
      return { ...message, entry: { ...message.entry, metadata } } as ChatMessage
    }
    const turns = buildTurns([
      user('u1', 'Real question'),
      withMeta('q1', { type: 'pending' }),
      withMeta('d1', { type: 'done' }),
      withMeta('s1', { type: 'system' }),
      withMeta('sub1', { subagent: { id: 'x' } }),
      user('u2', 'Second question'),
    ])
    expect(turns.map(t => t.messageId)).toEqual(['u1', 'u2'])
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

describe('turnNavigator paging', () => {
  const manyTurns = Array.from({ length: 100 }, (_, i) => ({ index: i * 2, messageId: `u${i}`, userText: `Q${i}`, replyText: '' }))

  /** jsdom has no layout: give the rail a fixed viewport over a taller list. */
  function layoutRail(scrollHeight: number, clientHeight: number) {
    const rail = screen.getByTestId('turn-rail')
    Object.defineProperty(rail, 'scrollHeight', { configurable: true, value: scrollHeight })
    Object.defineProperty(rail, 'clientHeight', { configurable: true, value: clientHeight })
    return rail
  }

  it('shows no paging buttons while every tick fits', () => {
    render(<TurnNavigator turns={manyTurns.slice(0, 3)} activeIndex={0} onJump={vi.fn()} />)
    fireEvent.scroll(layoutRail(24, 320))
    expect(screen.queryByRole('button', { name: 'session.earlierTurns' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'session.laterTurns' })).toBeNull()
  })

  it('pages the rail with the up and down buttons when ticks overflow', () => {
    render(<TurnNavigator turns={manyTurns} activeIndex={0} onJump={vi.fn()} />)
    const rail = layoutRail(800, 320)
    rail.scrollTop = 0
    fireEvent.scroll(rail)
    const up = screen.getByRole('button', { name: 'session.earlierTurns' })
    const down = screen.getByRole('button', { name: 'session.laterTurns' })
    expect(up).toBeDisabled()
    expect(down).toBeEnabled()

    fireEvent.click(down)
    expect(rail.scrollTop).toBeGreaterThan(0)
    fireEvent.scroll(rail)
    expect(screen.getByRole('button', { name: 'session.earlierTurns' })).toBeEnabled()

    rail.scrollTop = 480 // scrolled to the end
    fireEvent.scroll(rail)
    expect(screen.getByRole('button', { name: 'session.laterTurns' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'session.earlierTurns' }))
    expect(rail.scrollTop).toBeLessThan(480)
  })

  it('brings the tick of the turn in view into the rail when it is off-screen', () => {
    const { rerender } = render(<TurnNavigator turns={manyTurns} activeIndex={0} onJump={vi.fn()} />)
    const rail = layoutRail(800, 320)
    rail.scrollTop = 0
    const last = screen.getByRole('button', { name: 'session.jumpToTurn:100' })
    Object.defineProperty(last, 'offsetTop', { configurable: true, value: 792 })
    Object.defineProperty(last, 'offsetHeight', { configurable: true, value: 8 })
    rerender(<TurnNavigator turns={manyTurns} activeIndex={198} onJump={vi.fn()} />)
    // The tick ends at 800; the rail shows it once scrollTop reaches 800 - 320
    expect(rail.scrollTop).toBeGreaterThanOrEqual(800 - 320)
  })
})

describe('turnNavigator first load', () => {
  it('scrolls the rail to the current turn once the turns arrive, even if the current turn does not change', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ index: i * 2, messageId: `u${i}`, userText: `Q${i}`, replyText: '' }))
    // jsdom has no layout: the rail is 320px tall over 800px of ticks, 8px each
    const proto = HTMLElement.prototype
    const saved = ['scrollHeight', 'clientHeight', 'offsetTop', 'offsetHeight'].map(k => [k, Object.getOwnPropertyDescriptor(proto, k)] as const)
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get() {
      return this.dataset.testid === 'turn-rail' ? 800 : 0
    } })
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get() {
      return this.dataset.testid === 'turn-rail' ? 320 : 0
    } })
    Object.defineProperty(proto, 'offsetTop', { configurable: true, get() {
      const n = /(\d+)$/.exec(this.getAttribute('aria-label') ?? ''); return n ? (Number(n[1]) - 1) * 8 : 0
    } })
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, get() {
      return 8
    } })
    try {
      // First render while the conversation is loading: no rail yet
      const { rerender } = render(<TurnNavigator turns={many.slice(-1)} activeIndex={198} onJump={vi.fn()} />)
      rerender(<TurnNavigator turns={many} activeIndex={198} onJump={vi.fn()} />)
      expect(screen.getByTestId('turn-rail').scrollTop).toBeGreaterThanOrEqual(800 - 320)
    } finally {
      for (const [k, d] of saved) {
        if (d) Object.defineProperty(proto, k, d)
        else delete (proto as unknown as Record<string, unknown>)[k]
      }
    }
  })
})
