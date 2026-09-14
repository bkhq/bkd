import type { NormalizedLogEntry } from '@bkd/shared'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionMessages } from '@/components/issue-detail/SessionMessages'

const logRender = vi.hoisted(() => vi.fn())
const scrollToMock = vi.fn<(options: ScrollToOptions) => void>()
vi.mock('@/components/issue-detail/LogEntry', () => ({
  LogEntry: (props: { entry: NormalizedLogEntry, durationMs?: number }) => {
    logRender(props)
    return (
      <div data-log-id={props.entry.messageId} data-height={props.entry.content.length}>
        {props.entry.content}
        {props.durationMs}
      </div>
    )
  },
}))
vi.mock('@/components/issue-detail/ToolItems', () => ({
  ToolGroupMessage: ({ message }: { message: { items: Array<{ result: NormalizedLogEntry | null }> } }) => (
    <div>{message.items.map((item, i) => <span key={i}>{item.result?.content}</span>)}</div>
  ),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const observers = new Set<ResizeObserverMock>()
class ResizeObserverMock {
  elements = new Map<Element, number>()
  constructor(private callback: ResizeObserverCallback) {
    observers.add(this)
  }

  observe(element: Element) {
    this.elements.set(element, -1)
  }

  unobserve(element: Element) {
    this.elements.delete(element)
  }

  disconnect() {
    this.elements.clear(); observers.delete(this)
  }

  flush() {
    const entries: ResizeObserverEntry[] = []
    for (const [element, previous] of this.elements) {
      const height = (element as HTMLElement).offsetHeight
      if (height !== previous) {
        this.elements.set(element, height)
        const size = [{ blockSize: height, inlineSize: 800 }]
        entries.push({ target: element, borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size, contentRect: element.getBoundingClientRect() })
      }
    }
    if (entries.length) this.callback(entries, this as unknown as ResizeObserver)
  }
}

let scroll: HTMLDivElement
let frames: Map<number, FrameRequestCallback>
let frameId: number
const logs = (count: number, start = 100): NormalizedLogEntry[] => Array.from({ length: count }, (_, i) => ({
  messageId: `m${start + i}`,
  entryType: 'assistant-message',
  content: 'x'.repeat(40 + ((start + i) % 7) * 30),
}))
function settle() {
  for (let i = 0; i < 8; i++) {
    act(() => {
      for (const observer of observers) observer.flush()
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(i * 16)
      fireEvent.scroll(scroll)
    })
  }
}
function renderMessages(entries: NormalizedLogEntry[], isRunning = false) {
  const scrollRef = { current: scroll }
  const view = render(<SessionMessages logs={entries} scrollRef={scrollRef} isRunning={isRunning} />, { container: scroll })
  return { ...view, update: (next: NormalizedLogEntry[], running = isRunning) => view.rerender(<SessionMessages logs={next} scrollRef={scrollRef} isRunning={running} />) }
}
function expectNoOverlap() {
  const rows = [...scroll.querySelectorAll<HTMLElement>('[data-index]')]
  expect(rows.length).toBeGreaterThan(1)
  for (let i = 1; i < rows.length; i++) {
    const top = (row: HTMLElement) => Number(row.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1])
    expect(top(rows[i]) - top(rows[i - 1])).toBeGreaterThanOrEqual(rows[i - 1].offsetHeight)
  }
}

beforeEach(() => {
  frames = new Map()
  frameId = 0
  logRender.mockClear()
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback); return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  scroll = document.createElement('div')
  document.body.append(scroll)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this === scroll) return 600
    const height = this.querySelector<HTMLElement>('[data-height]')?.dataset.height
    if (this.hasAttribute('data-index')) return Number(height ?? 0)
    return Number.parseFloat(this.style.height) || this.scrollHeight
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this === scroll ? 0 : -scroll.scrollTop
    return { top, bottom: top + this.offsetHeight, height: this.offsetHeight, width: 800, left: 0, right: 800, x: 0, y: top, toJSON: () => ({}) }
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    const sizer = this.querySelector<HTMLElement>('[style*="position: relative"]')
    const height = Number.parseFloat(sizer?.style.height ?? '')
    return Number.isFinite(height) ? height : [...this.querySelectorAll<HTMLElement>('[data-height]')].reduce((sum, el) => sum + Number(el.dataset.height), 0)
  })
  scrollToMock.mockReset().mockImplementation((options) => {
    scroll.scrollTop = Math.max(0, Math.min(options.top ?? 0, scroll.scrollHeight - scroll.clientHeight))
  })
  scroll.scrollTo = scrollToMock as typeof scroll.scrollTo
})
afterEach(() => {
  cleanup()
  scroll.remove()
  observers.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('sessionMessages', () => {
  it('renders short conversations without a scroll container', () => {
    render(<SessionMessages logs={logs(3)} />, { container: scroll })
    expect(scroll.querySelectorAll('[data-log-id]')).toHaveLength(3)
  })

  it('initializes a virtual list when its parent scroll element mounts in the same commit', () => {
    const scrollRef: { current: HTMLDivElement | null } = { current: null }
    render(
      <div ref={(node) => {
        scrollRef.current = node
        if (node) {
          Object.defineProperty(node, 'offsetHeight', { value: 600 })
          node.scrollTo = vi.fn()
        }
      }}
      >
        <SessionMessages logs={logs(100)} scrollRef={scrollRef} />
      </div>,
      { container: scroll },
    )
    expect(scroll.querySelectorAll('[data-log-id]').length).toBeGreaterThan(0)
  })

  it.each([20, 79])('preserves the reading position when history is prepended to %i rows', (count) => {
    const entries = logs(count)
    const view = renderMessages(entries)
    settle()
    act(() => {
      scroll.scrollTop = 400
      fireEvent.scroll(scroll)
    })
    const older = logs(5, 95)
    view.update([...older, ...entries])
    settle()
    expect(scroll.scrollTop).toBe(400 + older.reduce((sum, entry) => sum + entry.content.length, 0))
  })

  it('retains measured heights when history is prepended and old live rows are trimmed', () => {
    const initial = logs(100)
    const view = renderMessages(initial)
    settle()
    act(() => {
      scroll.scrollTop = 800; fireEvent.scroll(scroll)
    })
    settle()
    expectNoOverlap()
    view.update([...logs(5, 95), ...initial])
    settle()
    expectNoOverlap()
    view.update(initial.slice(1))
    settle()
    expectNoOverlap()
  })

  it.each([60, 100])('follows streaming and delayed height changes with %i messages', (count) => {
    let entries = logs(count)
    const view = renderMessages(entries, true)
    settle()
    for (let i = 0; i < 5; i++) {
      entries = entries.map((entry, index) => index === entries.length - 1 ? { ...entry, content: `${entry.content}${'x'.repeat(200)}` } : entry)
      view.update(entries)
      settle()
      fireEvent.scroll(scroll)
      expect(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight).toBeLessThanOrEqual(1)
    }
    const last = scroll.querySelector<HTMLElement>(`[data-log-id="${entries.at(-1)!.messageId}"]`)!
    last.dataset.height = String(Number(last.dataset.height) + 300)
    settle()
    expect(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight).toBeLessThanOrEqual(1)
    expect(scrollToMock.mock.calls.some(([options]) => options.behavior === 'smooth')).toBe(false)
  })

  it('does not pull the reader back down after upward scrolling', () => {
    const entries = logs(60)
    const view = renderMessages(entries, true)
    settle()
    act(() => {
      scroll.scrollTop = 400; fireEvent.scroll(scroll)
    })
    view.update([...entries, ...logs(1, 200)])
    settle()
    expect(scroll.scrollTop).toBe(400)
  })

  it('avoids redundant scroll writes when already at the bottom', () => {
    const entries = logs(30)
    const view = renderMessages(entries)
    settle()
    scrollToMock.mockClear()
    view.update([...entries])
    settle()
    expect(scrollToMock).not.toHaveBeenCalled()
  })

  it('keeps bottom following across the virtualization threshold', () => {
    const entries = logs(79)
    const view = renderMessages(entries, true)
    settle()
    view.update([...entries, ...logs(1, 200)])
    settle()
    expect(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight).toBeLessThanOrEqual(1)
  })

  it('renders only the changed conversation row and still updates duration', () => {
    const entries = logs(10)
    const view = renderMessages(entries)
    settle()
    logRender.mockClear()
    const changed = entries.map((entry, i) => i === 9 ? { ...entry, content: 'updated' } : entry)
    view.update(changed)
    expect(logRender).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveTextContent('updated')
    view.update([...changed, { entryType: 'system-message', content: '', metadata: { duration: 1234 } }])
    expect(scroll).toHaveTextContent('1234')
  })

  it('resets bottom following when switching sessions', () => {
    const scrollRef = { current: scroll }
    const view = render(<SessionMessages sessionKey="first" logs={logs(30)} scrollRef={scrollRef} />, { container: scroll })
    settle()
    act(() => {
      scroll.scrollTop = 400
      fireEvent.scroll(scroll)
    })
    view.rerender(<SessionMessages sessionKey="second" logs={logs(100, 300)} scrollRef={scrollRef} />)
    settle()
    expect(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight).toBeLessThanOrEqual(1)
  })

  it('updates command output when the command entry is unchanged', () => {
    const command: NormalizedLogEntry = { messageId: 'command', entryType: 'user-message', content: '/status', metadata: { type: 'command' } }
    const view = renderMessages([command])
    view.update([command, { messageId: 'output', entryType: 'system-message', content: 'Current status', metadata: { subtype: 'command_output' } }])
    expect(scroll).toHaveTextContent('Current status')
  })

  it('updates grouped tool results and task plans after rebuilding', () => {
    const tool: NormalizedLogEntry = { messageId: 'tool', entryType: 'tool-use', content: '', metadata: { toolName: 'Read', toolCallId: 'call' } }
    const plan: NormalizedLogEntry = { messageId: 'plan', entryType: 'tool-use', content: '', metadata: { toolName: 'TodoWrite', input: { todos: [{ content: 'First task', status: 'pending' }] } } }
    const view = renderMessages([tool, plan])
    view.update([tool, { messageId: 'result', entryType: 'tool-use', content: 'updated result', metadata: { toolCallId: 'call', isResult: true } }, { ...plan, metadata: { toolName: 'TodoWrite', input: { todos: [{ content: 'Revised task', status: 'completed' }] } } }])
    expect(scroll).toHaveTextContent('updated result')
    expect(scroll).toHaveTextContent('Revised task')
  })
})
