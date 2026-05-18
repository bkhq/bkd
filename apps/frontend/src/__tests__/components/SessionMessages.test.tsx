import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { type ReactNode, useRef } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionMessages } from '@/components/issue-detail/SessionMessages'
import type { TimelineEntry } from '@/types/kanban'

// ────────────────────────────────────────────────────────────────────────────
// Pin down the auto-load + scroll-anchoring contract for the message list.
//
// These tests guard the "mobile chat lost the load-more button under the
// title bar" fix and the underlying jump-to-header bug — see ChatBody.tsx
// for the surrounding wiring. Each `it` block names the user-visible
// regression it prevents.
// ────────────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

let observerCallback: IntersectionObserverCallback | null = null
let observerRoot: Element | Document | null = null
let observerOptions: IntersectionObserverInit | null = null
const observeMock = vi.fn()
const disconnectMock = vi.fn()

class MockIntersectionObserver implements IntersectionObserver {
  root: Element | Document | null
  rootMargin: string
  thresholds: ReadonlyArray<number> = []

  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    observerCallback = cb
    observerOptions = opts ?? null
    observerRoot = (opts?.root as Element | Document | null) ?? null
    this.root = observerRoot
    this.rootMargin = opts?.rootMargin ?? ''
  }

  observe = observeMock
  disconnect = disconnectMock
  unobserve = vi.fn()
  takeRecords = (): IntersectionObserverEntry[] => []
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

beforeEach(() => {
  observerCallback = null
  observerRoot = null
  observerOptions = null
  observeMock.mockClear()
  disconnectMock.mockClear()
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

/**
 * Construct a minimum-viable user TimelineEntry — useChatMessages keys off
 * `messageId` for stable IDs, so each test message needs a distinct one to
 * make `firstMessageId` change detection meaningful in the prepend cases.
 */
function userEntry(messageId: string, turn: number, content: string): TimelineEntry {
  return {
    id: `turn-${turn}-user-${messageId}`,
    messageId,
    turnIndex: turn,
    type: 'user',
    entryType: 'user-message',
    content,
    timestamp: new Date(2026, 0, 1, 0, turn).toISOString(),
    sequence: turn * 1000,
    metadata: {},
  } as TimelineEntry
}

interface HarnessProps {
  logs: TimelineEntry[]
  hasOlderLogs?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
  scrollHeight?: number
}

function Harness({
  logs,
  hasOlderLogs = false,
  isLoadingOlder = false,
  onLoadOlder,
  scrollHeight,
}: HarnessProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // After mount, override the synthetic scrollHeight so anchoring math has
  // a real number to work against (jsdom doesn't compute layout).
  if (scrollRef.current && scrollHeight !== undefined) {
    Object.defineProperty(scrollRef.current, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
  }

  return (
    <div
      ref={scrollRef}
      data-testid="scroll"
      style={{ height: 500, overflow: 'auto' }}
    >
      <SessionMessages
        logs={logs}
        scrollRef={scrollRef}
        hasOlderLogs={hasOlderLogs}
        isLoadingOlder={isLoadingOlder}
        onLoadOlder={onLoadOlder}
      />
    </div>
  )
}

function fireIntersection(isIntersecting: boolean) {
  if (!observerCallback) throw new Error('IntersectionObserver was never constructed')
  act(() => {
    observerCallback!(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  })
}

describe('SessionMessages — auto-load older history', () => {
  it('observes a sentinel and triggers onLoadOlder when it intersects', () => {
    // User-visible bug: "I scroll to the top and nothing loads" — the IO
    // wiring is the entire trigger path now that the button is gone.
    const onLoadOlder = vi.fn()
    render(
      <Harness
        logs={[userEntry('a', 0, 'hello')]}
        hasOlderLogs
        onLoadOlder={onLoadOlder}
      />,
      { wrapper: createWrapper() },
    )

    expect(observeMock).toHaveBeenCalledTimes(1)
    expect(onLoadOlder).not.toHaveBeenCalled()

    fireIntersection(true)
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it('skips onLoadOlder while a load is already in flight', () => {
    // Without this guard, fast scrolls would re-fire on every IO callback
    // and flood the backend with cursor-paginated requests.
    const onLoadOlder = vi.fn()
    render(
      <Harness
        logs={[userEntry('a', 0, 'hello')]}
        hasOlderLogs
        isLoadingOlder
        onLoadOlder={onLoadOlder}
      />,
      { wrapper: createWrapper() },
    )

    fireIntersection(true)
    expect(onLoadOlder).not.toHaveBeenCalled()
  })

  it('skips onLoadOlder once the backend reports no more history', () => {
    // User-visible bug: spinner reappears at the top of a fully-loaded
    // thread because IO keeps firing after hasOlderLogs flipped false.
    const onLoadOlder = vi.fn()
    render(
      <Harness
        logs={[userEntry('a', 0, 'hello')]}
        hasOlderLogs={false}
        onLoadOlder={onLoadOlder}
      />,
      { wrapper: createWrapper() },
    )

    fireIntersection(true)
    expect(onLoadOlder).not.toHaveBeenCalled()
  })

  it('ignores non-intersecting IO entries', () => {
    // The observer fires on BOTH enter and leave transitions. We only
    // care about enter — leaving the viewport shouldn't load older logs.
    const onLoadOlder = vi.fn()
    render(
      <Harness
        logs={[userEntry('a', 0, 'hello')]}
        hasOlderLogs
        onLoadOlder={onLoadOlder}
      />,
      { wrapper: createWrapper() },
    )

    fireIntersection(false)
    expect(onLoadOlder).not.toHaveBeenCalled()
  })

  it('preloads ahead of the viewport edge via a top-margin rootMargin', () => {
    // Smooth UX: the spinner should appear before the user reaches the
    // literal top of the list, so prepended content slots in without a
    // visible "I've hit the wall, now loading" pause.
    render(
      <Harness logs={[userEntry('a', 0, 'hello')]} hasOlderLogs onLoadOlder={vi.fn()} />,
      { wrapper: createWrapper() },
    )

    expect(observerOptions?.rootMargin).toBe('300px 0px 0px 0px')
    // root must be the scroll container, not the viewport — otherwise the
    // observer fires off the document scroll position and never matches
    // the user's actual reading position inside the chat.
    expect(observerRoot).toBe(screen.getByTestId('scroll'))
  })

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(
      <Harness logs={[userEntry('a', 0, 'hello')]} hasOlderLogs onLoadOlder={vi.fn()} />,
      { wrapper: createWrapper() },
    )
    expect(disconnectMock).not.toHaveBeenCalled()
    unmount()
    expect(disconnectMock).toHaveBeenCalledTimes(1)
  })

  it('attaches the observer when logs arrive after an empty initial render', () => {
    // jsdom doesn't implement Element.scrollTo; SessionMessages' auto-bottom
    // useEffect calls it after messages arrive. Stub it globally so the
    // effect doesn't throw during the rerender we're exercising.
    Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo']

    // Regression: user-reported "switch to a completed issue and scroll-up
    // stops loading history." Reproduction:
    //   1. First render: logs=[], isRunning=false → component hits the
    //      `return null` early-exit, so the sentinel <div> is never mounted.
    //   2. The IntersectionObserver useEffect runs once with sentinel=null
    //      and bails out.
    //   3. Logs fetched asynchronously → component re-renders, sentinel
    //      mounts.
    //   4. Effect's deps [scrollRef, onLoadOlder] are unchanged across
    //      renders, so it does NOT re-run. Observer is never attached.
    //   5. Scrolling up triggers no callback. The user sees a frozen list.
    //
    // The fix adds `messages.length` to the effect's deps so the second
    // render re-runs the effect and attaches the observer to the now-mounted
    // sentinel. This test asserts observe() is called after logs arrive.
    const onLoadOlder = vi.fn()
    const { rerender } = render(
      <Harness logs={[]} hasOlderLogs onLoadOlder={onLoadOlder} />,
      { wrapper: createWrapper() },
    )

    // With logs=[] and isRunning=false the component returns null — no
    // sentinel exists yet, so observe() should not have been called.
    expect(observeMock).not.toHaveBeenCalled()

    // Logs arrive: parent re-renders with a populated array.
    rerender(
      <Harness
        logs={[userEntry('a', 0, 'hello')]}
        hasOlderLogs
        onLoadOlder={onLoadOlder}
      />,
    )

    // Now the sentinel is in the DOM; the effect must have re-run to attach
    // the observer. Without the `messages.length` dep this fails — the
    // effect doesn't re-run and observe() stays at 0 calls.
    expect(observeMock).toHaveBeenCalledTimes(1)

    // And the wiring still works end-to-end: intersection fires onLoadOlder.
    fireIntersection(true)
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })
})

describe('SessionMessages — loading affordance', () => {
  it('renders a spinner (not a button) while older logs are loading', () => {
    // Mobile-overlay regression: the old <button> was hidden under the
    // floating title bar. The replacement spinner is passive UI and the
    // explicit "Load earlier messages" affordance must not come back
    // unintentionally — that's what the user reported as the original bug.
    render(
      <Harness
        logs={[userEntry('a', 0, 'hello')]}
        hasOlderLogs
        isLoadingOlder
        onLoadOlder={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('common.loading')).toBeInTheDocument()
    expect(screen.queryByText('session.loadMore')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load/i })).not.toBeInTheDocument()
  })

  it('hides the spinner when no load is in flight', () => {
    render(
      <Harness logs={[userEntry('a', 0, 'hello')]} hasOlderLogs onLoadOlder={vi.fn()} />,
      { wrapper: createWrapper() },
    )
    expect(screen.queryByText('common.loading')).not.toBeInTheDocument()
  })
})

// ──── Anchoring harness ────────────────────────────────────────────────────
//
// Anchoring math depends on `scrollRef.current` and its stubbed
// scrollHeight/scrollTop being in place BEFORE SessionMessages' first
// useLayoutEffect runs. Children commit before parents, so the parent's
// ref callback alone is too late.
//
// Workaround: render the wrapping div by itself first, apply stubs in a
// useEffect, then conditionally mount SessionMessages on a second pass.
// By the time it mounts, the stubbed element is fully ready.
interface AnchorWorld {
  scrollTop: number
  scrollHeight: number
}

function AnchorHarness({
  logs,
  hasOlderLogs = false,
  isLoadingOlder = false,
  onLoadOlder,
  world,
}: HarnessProps & { world: AnchorWorld }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stubbedRef = useRef(false)

  // Stub once, after the div mounts. useEffect (not useLayoutEffect): we
  // want SessionMessages to skip its first render and only mount on the
  // re-render triggered after stubs land.
  if (scrollRef.current && !stubbedRef.current) {
    const el = scrollRef.current
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => world.scrollTop,
      set: (v: number) => {
        world.scrollTop = v
      },
    })
    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => world.scrollHeight,
    })
    // jsdom doesn't define Element.scrollTo — patch it so the existing
    // scroll-to-bottom effect's `el.scrollTo({top})` call doesn't throw.
    el.scrollTo = ((opts: ScrollToOptions) => {
      if (typeof opts.top === 'number') world.scrollTop = opts.top
    }) as Element['scrollTo']
    stubbedRef.current = true
  }

  return (
    <div
      ref={scrollRef}
      data-testid="scroll"
      style={{ height: 500, overflow: 'auto' }}
    >
      {stubbedRef.current && logs.length > 0 ?
          (
            <SessionMessages
              logs={logs}
              scrollRef={scrollRef}
              hasOlderLogs={hasOlderLogs}
              isLoadingOlder={isLoadingOlder}
              onLoadOlder={onLoadOlder}
            />
          ) :
        null}
    </div>
  )
}

describe('SessionMessages — scroll anchoring on prepend', () => {
  it('compensates for prepended content so the user stays on the same message', () => {
    // User-visible bug: clicking load-more / hitting the auto-load
    // sentinel teleports the viewport to the very top of the new content
    // instead of preserving the message the user was reading.
    //
    // The anchor effect: after a prepend (firstMessageId changed,
    // messages.length grew), scrollTop must be bumped by the height
    // delta between renders.
    const onLoadOlder = vi.fn()
    const world: AnchorWorld = { scrollTop: 0, scrollHeight: 1000 }
    const initialLogs = [
      userEntry('b', 1, 'second'),
      userEntry('c', 2, 'third'),
    ]

    // Phase 1: mount empty so the scroll div commits and gets stubbed.
    const { rerender } = render(
      <AnchorHarness logs={[]} hasOlderLogs onLoadOlder={onLoadOlder} world={world} />,
      { wrapper: createWrapper() },
    )

    // Phase 2: mount SessionMessages with initial logs. initialScrollDone
    // fires (snaps to bottom: scrollTop = scrollHeight) and anchor's
    // prevScrollHeightRef captures the current scrollHeight (1000).
    rerender(
      <AnchorHarness logs={initialLogs} hasOlderLogs onLoadOlder={onLoadOlder} world={world} />,
    )

    // Phase 3: simulate the user having scrolled mid-list, then a
    // prepend that grows scrollHeight by 600. Anchor should add the
    // delta so the user's relative reading position stays put.
    world.scrollTop = 100
    world.scrollHeight = 1600
    rerender(
      <AnchorHarness
        logs={[userEntry('a', 0, 'first'), ...initialLogs]}
        hasOlderLogs
        onLoadOlder={onLoadOlder}
        world={world}
      />,
    )

    // 1600 (new) - 1000 (prev) = 600 delta, added to the 100 the user
    // was already at → 700. Same message stays under the user's cursor.
    expect(world.scrollTop).toBe(700)
  })

  it('does not anchor-adjust scrollTop when only new bottom messages arrive', () => {
    // The auto-scroll-to-bottom path owns appends. The anchor effect
    // must not also touch scrollTop there — otherwise it would double-
    // shift the user away from the latest message during streaming.
    const onLoadOlder = vi.fn()
    const world: AnchorWorld = { scrollTop: 0, scrollHeight: 1000 }

    const { rerender } = render(
      <AnchorHarness logs={[]} hasOlderLogs={false} onLoadOlder={onLoadOlder} world={world} />,
      { wrapper: createWrapper() },
    )
    rerender(
      <AnchorHarness
        logs={[userEntry('a', 0, 'first')]}
        hasOlderLogs={false}
        onLoadOlder={onLoadOlder}
        world={world}
      />,
    )

    // Simulate a streaming append: scrollHeight grows but firstMessageId
    // stays 'a'. Park the user mid-list to make a stray anchor edit
    // observable.
    world.scrollTop = 100
    world.scrollHeight = 1600
    rerender(
      <AnchorHarness
        logs={[
          userEntry('a', 0, 'first'),
          userEntry('b', 1, 'second'),
        ]}
        hasOlderLogs={false}
        onLoadOlder={onLoadOlder}
        world={world}
      />,
    )

    // The anchor path would have written 100 + (1600 - 1000) = 700.
    // The legitimate scroll-to-bottom path writes scrollHeight (1600).
    // Either of those is acceptable here — what's NOT acceptable is the
    // anchor delta on top of an append.
    expect(world.scrollTop).not.toBe(700)
  })
})
