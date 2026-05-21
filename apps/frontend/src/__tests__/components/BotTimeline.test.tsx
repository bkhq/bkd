import type { CockpitTimelineMessage } from '@bkd/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BotTimeline } from '@/components/cockpit/BotTimeline'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | object, opts?: { n?: number }) => {
      const f = typeof fallback === 'string' ? fallback : key
      if (opts && typeof opts.n === 'number') return f.replace('{{n}}', String(opts.n))
      return f
    },
    i18n: { language: 'en' },
  }),
}))

// Lightweight CockpitQuickCreate stub — the real one pulls in too many
// hooks and is irrelevant to these tests.
vi.mock('@/components/cockpit/CockpitQuickCreate', () => ({
  CockpitQuickCreate: () => null,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

type CockpitTimelineListener = (delta: { op: 'append' | 'update', message: unknown }) => void
const timelineListeners = new Set<CockpitTimelineListener>()
vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    onCockpitTimeline: (l: CockpitTimelineListener) => {
      timelineListeners.add(l)
      return () => timelineListeners.delete(l)
    },
  },
}))

const emptyCounts = { suggest_merge: 0, alert_off_track: 0, suggest_reply: 0, alert_repeat_fail: 0, alert_stale_working: 0, ack: 0, info: 0 }
const timelineDataRef = { current: { messages: [] as CockpitTimelineMessage[], counts: { ...emptyCounts } } }
const isLoadingRef = { current: false }
const errorRef = { current: null as Error | null }
const ackMutate = vi.fn()
const dismissMutate = vi.fn()
const snoozeMutate = vi.fn()
const executeMutate = vi.fn()

vi.mock('@/hooks/use-cockpit-timeline', () => ({
  useCockpitTimeline: () => ({
    data: timelineDataRef.current,
    isLoading: isLoadingRef.current,
    error: errorRef.current,
  }),
  useAckCockpitTimeline: () => ({ mutate: ackMutate, mutateAsync: ackMutate, isPending: false }),
  useDismissCockpitTimeline: () => ({ mutate: dismissMutate, isPending: false }),
  useSnoozeCockpitTimeline: () => ({ mutate: snoozeMutate, isPending: false }),
  useExecuteCockpitAction: () => ({
    mutate: (vars: unknown, opts?: { onSuccess?: () => void }) => {
      executeMutate(vars)
      opts?.onSuccess?.()
    },
    isPending: false,
  }),
}))

function mkMsg(over: Partial<CockpitTimelineMessage> = {}): CockpitTimelineMessage {
  return {
    id: 'm1',
    kind: 'suggest_merge',
    projectId: 'p1',
    projectAlias: 'demo',
    issueId: 'i1',
    issueNumber: 7,
    issueTitle: 'add retry',
    body: 'demo/#7 add retry looks ready.',
    actions: [
      { id: 'merge', label: 'Move to done', kind: 'proposal', tone: 'primary', payload: { type: 'merge_issue', params: { issueId: 'i1' } } },
      { id: 'snooze1h', label: 'Snooze 1h', kind: 'snooze', payload: { hours: 1 } },
      { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
    ],
    signalKey: 'merge:i1',
    status: 'open',
    snoozedUntil: null,
    recommendation: null,
    enrichedAt: null,
    enrichmentStatus: 'template',
    enrichmentError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
}

describe('botTimeline', () => {
  beforeEach(() => {
    timelineDataRef.current = { messages: [], counts: { ...emptyCounts } }
    isLoadingRef.current = false
    errorRef.current = null
    ackMutate.mockReset()
    dismissMutate.mockReset()
    snoozeMutate.mockReset()
    executeMutate.mockReset()
    timelineListeners.clear()
    if (typeof window !== 'undefined') window.localStorage.removeItem('cockpit.timeline.sound')
  })

  it('renders empty state with no messages', () => {
    render(<Wrapper><BotTimeline /></Wrapper>)
    expect(
      screen.getByText('All caught up — I will speak up when something needs you.'),
    ).toBeDefined()
  })

  it('renders bucket counts in status strip', () => {
    timelineDataRef.current = {
      messages: [mkMsg(), mkMsg({ id: 'm2', kind: 'alert_off_track', signalKey: 'offtrack:i2', issueId: 'i2' })],
      counts: { ...emptyCounts, suggest_merge: 1, alert_off_track: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    expect(screen.getByText('1 ready')).toBeDefined()
    expect(screen.getByText('1 off-track')).toBeDefined()
  })

  it('renders message body + actions and invokes execute on proposal click', () => {
    timelineDataRef.current = {
      messages: [mkMsg()],
      counts: { ...emptyCounts, suggest_merge: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    expect(screen.getByText(/add retry looks ready/)).toBeDefined()
    fireEvent.click(screen.getByText('Move to done'))
    expect(executeMutate).toHaveBeenCalledWith({
      type: 'merge_issue',
      params: { issueId: 'i1' },
    })
    // proposal success path also fires ack
    expect(ackMutate).toHaveBeenCalledWith('m1')
  })

  it('renders an enriched reply card and sends the preset reply on click', () => {
    timelineDataRef.current = {
      messages: [mkMsg({
        id: 'r1',
        kind: 'suggest_reply',
        signalKey: 'reply:i1',
        body: 'How should order status be stored?',
        enrichmentStatus: 'enriched',
        recommendation: { actionId: 'preset0', reasoning: 'Enum is simpler for 4 states.' },
        actions: [
          { id: 'preset0', label: 'Use an enum', kind: 'reply-preset', tone: 'primary', payload: { issueId: 'i1', text: 'Use an enum.' } },
          { id: 'reply', label: 'Reply…', kind: 'reply-input', payload: { issueId: 'i1' } },
          { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
        ],
      })],
      counts: { ...emptyCounts, suggest_reply: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    // recommendation reasoning + enrichment badge are visible
    expect(screen.getByText('Enum is simpler for 4 states.')).toBeDefined()
    expect(screen.getByText('enriched')).toBeDefined()
    // clicking the preset sends the drafted reply back, no typing
    fireEvent.click(screen.getByText('Use an enum'))
    expect(executeMutate).toHaveBeenCalledWith({
      type: 'send_reply',
      params: { issueId: 'i1', body: 'Use an enum.' },
    })
    expect(ackMutate).toHaveBeenCalledWith('r1')
  })

  it('shows the AI-failed badge when enrichmentError is set', () => {
    timelineDataRef.current = {
      messages: [mkMsg({
        id: 'r2',
        kind: 'suggest_reply',
        signalKey: 'reply:i2',
        issueId: 'i2',
        enrichmentStatus: 'structured',
        enrichmentError: 'timeout',
      })],
      counts: { ...emptyCounts, suggest_reply: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    expect(screen.getByText('AI failed')).toBeDefined()
    expect(screen.getByText('options')).toBeDefined()
  })

  it('snooze 1h preset fires snooze mutation with ~1h-ahead untilMs', () => {
    timelineDataRef.current = {
      messages: [mkMsg()],
      counts: { ...emptyCounts, suggest_merge: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    fireEvent.click(screen.getByTestId('snooze-trigger-m1'))
    const before = Date.now()
    fireEvent.click(screen.getByTestId('snooze-1h-m1'))
    expect(snoozeMutate).toHaveBeenCalledTimes(1)
    const call = snoozeMutate.mock.calls[0]![0] as { id: string, untilMs: number }
    expect(call.id).toBe('m1')
    expect(call.untilMs).toBeGreaterThan(before + 59 * 60 * 1000)
  })

  it('dismiss button fires dismiss mutation', () => {
    timelineDataRef.current = {
      messages: [mkMsg()],
      counts: { ...emptyCounts, suggest_merge: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(dismissMutate).toHaveBeenCalledWith('m1')
  })

  it('hides dismissed / superseded messages from the list', () => {
    timelineDataRef.current = {
      messages: [
        mkMsg({ id: 'm-open' }),
        mkMsg({ id: 'm-dismissed', status: 'dismissed', body: 'demo/#9 should not show.' }),
        mkMsg({ id: 'm-superseded', status: 'superseded', body: 'demo/#10 should not show.' }),
      ],
      counts: { ...emptyCounts, suggest_merge: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    expect(screen.queryByText(/#9 should not show/)).toBeNull()
    expect(screen.queryByText(/#10 should not show/)).toBeNull()
  })

  it('shows bulk-merge toolbar when there are ≥ 2 mergeable rows', () => {
    timelineDataRef.current = {
      messages: [
        mkMsg({ id: 'a', issueId: 'i-a' }),
        mkMsg({ id: 'b', issueId: 'i-b', signalKey: 'merge:i-b' }),
      ],
      counts: { ...emptyCounts, suggest_merge: 2 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    expect(screen.getByTestId('bulk-merge-select-all')).toBeDefined()
    expect(screen.getByTestId('bulk-merge-trigger')).toBeDefined()
  })

  it('bulk-merge select-all + confirm dispatches bulk_merge with selected issueIds', () => {
    timelineDataRef.current = {
      messages: [
        mkMsg({ id: 'a', issueId: 'i-a', signalKey: 'merge:i-a' }),
        mkMsg({ id: 'b', issueId: 'i-b', signalKey: 'merge:i-b' }),
      ],
      counts: { ...emptyCounts, suggest_merge: 2 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    fireEvent.click(screen.getByTestId('bulk-merge-select-all'))
    fireEvent.click(screen.getByTestId('bulk-merge-trigger'))
    fireEvent.click(screen.getByTestId('bulk-merge-confirm'))
    expect(executeMutate).toHaveBeenCalledWith({
      type: 'bulk_merge',
      params: { issueIds: ['i-a', 'i-b'] },
    })
  })

  it('suggest_reply row opens an inline textarea + send dispatches send_reply', () => {
    timelineDataRef.current = {
      messages: [
        mkMsg({
          id: 'r1',
          kind: 'suggest_reply',
          signalKey: 'reply:i-r',
          issueId: 'i-r',
          body: 'demo/#3 awaiting your reply.',
          actions: [
            { id: 'reply', label: 'Reply', kind: 'reply-input', tone: 'primary', payload: { issueId: 'i-r' } },
            { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
          ],
        }),
      ],
      counts: { ...emptyCounts, suggest_reply: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    fireEvent.click(screen.getByText('Reply'))
    const textarea = screen.getByTestId('reply-input-r1') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'yes, please proceed' } })
    fireEvent.click(screen.getByTestId('reply-send-r1'))
    expect(executeMutate).toHaveBeenCalledWith({
      type: 'send_reply',
      params: { issueId: 'i-r', body: 'yes, please proceed' },
    })
    expect(ackMutate).toHaveBeenCalledWith('r1')
  })

  it('sound toggle persists to localStorage and flips between Bell / BellOff', () => {
    render(<Wrapper><BotTimeline /></Wrapper>)
    const btn = screen.getByTestId('cockpit-sound-toggle')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(window.localStorage.getItem('cockpit.timeline.sound')).not.toBe('1')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem('cockpit.timeline.sound')).toBe('1')
    fireEvent.click(btn)
    expect(window.localStorage.getItem('cockpit.timeline.sound')).toBe('0')
  })

  it('snooze dropdown exposes 1h / 4h / Until tonight presets', () => {
    timelineDataRef.current = {
      messages: [mkMsg()],
      counts: { ...emptyCounts, suggest_merge: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    fireEvent.click(screen.getByTestId('snooze-trigger-m1'))
    // base-ui menu portal: querying body
    expect(screen.getByTestId('snooze-1h-m1')).toBeDefined()
    expect(screen.getByTestId('snooze-4h-m1')).toBeDefined()
    expect(screen.getByTestId('snooze-today-m1')).toBeDefined()
  })

  it('selecting 4h preset calls snooze.mutate with ~4h-ahead untilMs', () => {
    timelineDataRef.current = {
      messages: [mkMsg()],
      counts: { ...emptyCounts, suggest_merge: 1 },
    }
    render(<Wrapper><BotTimeline /></Wrapper>)
    fireEvent.click(screen.getByTestId('snooze-trigger-m1'))
    const before = Date.now()
    fireEvent.click(screen.getByTestId('snooze-4h-m1'))
    expect(snoozeMutate).toHaveBeenCalledTimes(1)
    const call = snoozeMutate.mock.calls[0]![0] as { id: string, untilMs: number }
    expect(call.id).toBe('m1')
    // 4h is 14_400_000ms; allow some slop
    expect(call.untilMs).toBeGreaterThan(before + 3.9 * 60 * 60 * 1000)
    expect(call.untilMs).toBeLessThan(before + 4.2 * 60 * 60 * 1000)
  })

  it('shows error state when query errors', () => {
    errorRef.current = new Error('boom')
    render(<Wrapper><BotTimeline /></Wrapper>)
    expect(screen.getByText('Failed to load timeline')).toBeDefined()
  })
})
