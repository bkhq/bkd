import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CurrentPromptHover } from '@/components/issue-detail/CurrentPromptHover'
import type { NormalizedLogEntry } from '@/types/kanban'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

// Stub rAF so scroll handlers run synchronously in tests.
beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    },
  )
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

interface TurnSpec {
  turn: number
  content: string
}

/**
 * Test harness: renders the component inside a scroll container with
 * fake `[data-user-turn]` anchors. Geometry is stubbed by the test body
 * AFTER render via `applyGeometry()` then a `scroll` event flushes a
 * fresh measure(). Keeping geometry stubbing out of the React lifecycle
 * avoids React 19's "act not awaited" warning when state updates fire
 * from inside parent useEffects.
 */
function Harness({ turns }: { turns: TurnSpec[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const logs: NormalizedLogEntry[] = turns.map(t => ({
    entryType: 'user-message',
    content: t.content,
    turnIndex: t.turn,
    timestamp: new Date(2026, 0, 1, 0, t.turn).toISOString(),
    messageId: `m-${t.turn}`,
  }))

  return (
    <div
      ref={scrollRef}
      data-testid="scroll-container"
      style={{ height: 500, overflow: 'auto' }}
    >
      <CurrentPromptHover logs={logs} scrollRef={scrollRef} />
      {turns.map(t => (
        <div key={t.turn} data-user-turn={t.turn}>
          {t.content}
        </div>
      ))}
    </div>
  )
}

interface Geometry {
  [turn: number]: 'above' | 'inView' | 'below'
}

/**
 * Stubs getBoundingClientRect on the scroll container and each anchor
 * matching the geometry map, then fires a synchronous scroll event so
 * the component re-measures.
 */
function applyGeometry(geometry: Geometry) {
  const container = screen.getByTestId('scroll-container')
  container.getBoundingClientRect = () => ({
    top: 100,
    bottom: 600,
    left: 0,
    right: 800,
    width: 800,
    height: 500,
    x: 0,
    y: 100,
    toJSON: () => ({}),
  }) as DOMRect
  Object.defineProperty(container, 'clientHeight', { value: 500, configurable: true })

  const anchors = container.querySelectorAll<HTMLElement>('[data-user-turn]')
  anchors.forEach((node) => {
    const turn = Number(node.dataset.userTurn)
    const pos = geometry[turn]
    if (!pos) return
    const rect = pos === 'above'
      ? { top: 20, bottom: 60 }
      : pos === 'inView'
        ? { top: 200, bottom: 260 }
        : { top: 700, bottom: 760 }
    node.getBoundingClientRect = () => ({
      ...rect,
      left: 0,
      right: 800,
      width: 800,
      height: rect.bottom - rect.top,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect
  })

  act(() => {
    fireEvent.scroll(container)
  })
}

describe('currentPromptHover', () => {
  it('renders nothing when there is only one user prompt', () => {
    render(<Harness turns={[{ turn: 0, content: 'first' }]} />)
    applyGeometry({ 0: 'above' })
    expect(screen.queryByText('chat.currentPrompt.viewing')).toBeNull()
  })

  it('renders nothing when no prompts have scrolled past the top', () => {
    render(
      <Harness
        turns={[
          { turn: 0, content: 'one' },
          { turn: 1, content: 'two' },
        ]}
      />,
    )
    applyGeometry({ 0: 'inView', 1: 'below' })
    expect(screen.queryByText('chat.currentPrompt.viewing')).toBeNull()
  })

  it('shows the most recently passed user prompt', () => {
    render(
      <Harness
        turns={[
          { turn: 0, content: 'first question' },
          { turn: 1, content: 'second question' },
        ]}
      />,
    )
    applyGeometry({ 0: 'above', 1: 'inView' })
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'first question')
  })

  it('uses the latest passed prompt when multiple have scrolled out', () => {
    render(
      <Harness
        turns={[
          { turn: 0, content: 'old question' },
          { turn: 1, content: 'newer question' },
          { turn: 2, content: 'pending question' },
        ]}
      />,
    )
    applyGeometry({ 0: 'above', 1: 'above', 2: 'below' })
    // Two banner-content elements may exist (banner + anchor div), so
    // assert the banner button title carries the active prompt.
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'newer question')
  })

  it('hides when the active prompt becomes visible again', () => {
    render(
      <Harness
        turns={[
          { turn: 0, content: 'visible again' },
          { turn: 1, content: 'next' },
        ]}
      />,
    )
    applyGeometry({ 0: 'inView', 1: 'below' })
    expect(screen.queryByText('chat.currentPrompt.viewing')).toBeNull()
  })

  it('clicking the banner scrolls the matching anchor into view', () => {
    render(
      <Harness
        turns={[
          { turn: 0, content: 'jump target' },
          { turn: 1, content: 'second' },
        ]}
      />,
    )
    applyGeometry({ 0: 'above', 1: 'below' })
    const button = screen.getByRole('button', { name: /jump target/ })
    const anchor = document.querySelector<HTMLElement>('[data-user-turn="0"]')!
    const spy = vi.fn()
    anchor.scrollIntoView = spy
    fireEvent.click(button)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toMatchObject({ block: 'start', behavior: 'smooth' })
  })

  it('truncates long prompts via truncate class but keeps full text in title', () => {
    const long = 'a'.repeat(500)
    render(
      <Harness
        turns={[
          { turn: 0, content: long },
          { turn: 1, content: 'next' },
        ]}
      />,
    )
    applyGeometry({ 0: 'above', 1: 'below' })
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', long)
    const span = button.querySelector('.truncate')
    expect(span).not.toBeNull()
    expect(span?.textContent).toBe(long)
  })

  it('strips "--- Attached files ---" block from displayed content', () => {
    const content = 'real question\n--- Attached files ---\n[Attached file: foo.txt]\n'
    render(
      <Harness
        turns={[
          { turn: 0, content },
          { turn: 1, content: 'next' },
        ]}
      />,
    )
    applyGeometry({ 0: 'above', 1: 'below' })
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('title', 'real question')
  })

  it('skips pending and done user messages', () => {
    const logs: NormalizedLogEntry[] = [
      {
        entryType: 'user-message',
        content: 'pending one',
        turnIndex: 0,
        metadata: { type: 'pending' },
        messageId: 'p1',
      },
      {
        entryType: 'user-message',
        content: 'done one',
        turnIndex: 1,
        metadata: { type: 'done' },
        messageId: 'd1',
      },
    ]

    function PendingHarness() {
      const ref = useRef<HTMLDivElement>(null)
      return (
        <div ref={ref} style={{ height: 500 }}>
          <CurrentPromptHover logs={logs} scrollRef={ref} />
        </div>
      )
    }

    render(<PendingHarness />)
    expect(screen.queryByText('chat.currentPrompt.viewing')).toBeNull()
  })
})
