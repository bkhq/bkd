import type { DecisionEvent } from '@bkd/shared'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import DecisionsPage from '@/pages/DecisionsPage'

const mocks = vi.hoisted(() => ({
  events: [] as unknown[],
  decide: vi.fn(),
  close: vi.fn(),
  notify: vi.fn(),
}))

function event(overrides: Partial<DecisionEvent>): DecisionEvent {
  return {
    id: 'ev1',
    status: 'open',
    campaignId: 'camp-1',
    ref: 'i2',
    question: 'Merge the storage rewrite now?',
    context: 'apps/api/src/db/index.ts:10-40',
    options: [
      { id: 'A', label: 'Merge now', impact: 'unblocks lane 2' },
      { id: 'B', label: 'Wait for review', impact: 'one more day' },
    ],
    recommendation: { optionId: 'A', reason: 'tests are green' },
    blocks: 'lane 2',
    continues: 'lane 3',
    notify: { type: 'bkd-follow-up', projectId: 'p1', issueId: 'i1' },
    decision: null,
    outcome: null,
    withdrawReason: null,
    closeReason: null,
    notifiedAt: null,
    links: {
      projectName: 'Fleet',
      ref: { issueId: 'i2', projectId: 'p1', issueNumber: 12, title: 'Storage lane' },
      notify: { issueId: 'i1', projectId: 'p1', issueNumber: 3, title: 'Coordinator' },
    },
    createdAt: '2026-10-13T08:00:00.000Z',
    updatedAt: '2026-10-13T08:00:00.000Z',
    ...overrides,
  }
}

const decided = {
  optionId: 'B',
  instruction: 'after the audit',
  decidedBy: 'user',
  decidedAt: '2026-10-13T09:00:00.000Z',
}

vi.mock('@/components/kanban/AppSidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/kanban/MobileSidebar', () => ({ MobileSidebar: () => null }))
vi.mock('@/hooks/use-decision-events', () => ({
  useDecisionEvents: () => ({ data: mocks.events, isLoading: false }),
  useDecideDecisionEvent: () => ({ mutate: mocks.decide, isPending: false, error: null }),
  useCloseDecisionEvent: () => ({ mutate: mocks.close, reset: vi.fn(), isPending: false, error: null }),
  useNotifyDecisionEvent: () => ({ mutate: mocks.notify, isPending: false, error: null }),
}))

function renderPage(events: DecisionEvent[]) {
  mocks.events = events
  render(
    <MemoryRouter>
      <DecisionsPage />
    </MemoryRouter>,
  )
}

describe('decisions page', () => {
  beforeEach(async () => {
    mocks.decide.mockReset()
    mocks.close.mockReset()
    mocks.notify.mockReset()
    await i18n.changeLanguage('en')
  })

  afterEach(cleanup)

  it('shows the card of a waiting event', () => {
    renderPage([event({})])

    expect(screen.getByText('Merge the storage rewrite now?')).toBeInTheDocument()
    expect(screen.getByText('apps/api/src/db/index.ts:10-40')).toBeInTheDocument()
    expect(screen.getByText('unblocks lane 2')).toBeInTheDocument()
    expect(screen.getByText('Recommended')).toBeInTheDocument()
    expect(screen.getByText('Recommended: tests are green')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#12 Storage lane' }))
      .toHaveAttribute('href', '/projects/p1/issues/i2')
    expect(screen.getByRole('link', { name: '#3 Coordinator' }))
      .toHaveAttribute('href', '/projects/p1/issues/i1')
  })

  it('decides with the chosen option and the instruction', () => {
    renderPage([event({})])
    const decide = screen.getByRole('button', { name: 'Decide' })
    expect(decide).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: /B\. Wait for review/ }))
    fireEvent.change(screen.getByLabelText('Instruction'), { target: { value: '  after the audit ' } })
    fireEvent.click(decide)

    expect(mocks.decide).toHaveBeenCalledWith({ id: 'ev1', optionId: 'B', instruction: 'after the audit' })
  })

  it('decides with an instruction alone', () => {
    renderPage([event({ options: [], recommendation: null })])

    fireEvent.change(screen.getByLabelText('Instruction'), { target: { value: 'Split it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decide' }))

    expect(mocks.decide).toHaveBeenCalledWith({ id: 'ev1', optionId: null, instruction: 'Split it' })
  })

  it('closes an event after confirmation, passing the reason', () => {
    renderPage([event({})])

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mocks.close).not.toHaveBeenCalled()

    const dialog = screen.getByRole('alertdialog')
    fireEvent.change(within(dialog).getByLabelText('Closed because'), { target: { value: 'not needed' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(mocks.close).toHaveBeenCalledWith({ id: 'ev1', reason: 'not needed' }, expect.anything())
  })

  it('lists decided events with a resend action when the agent was not notified', () => {
    renderPage([
      event({}),
      event({ id: 'ev2', status: 'decided', question: 'Ship it?', decision: decided }),
    ])
    expect(screen.queryByText('Ship it?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Decided/ }))

    expect(screen.getByText('Ship it?')).toBeInTheDocument()
    expect(screen.getByText('B. Wait for review')).toBeInTheDocument()
    expect(screen.getByText('after the audit')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Decide' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    expect(mocks.notify).toHaveBeenCalledWith('ev2')
  })

  it('hides resend once the agent was notified', () => {
    renderPage([event({ status: 'decided', decision: decided, notifiedAt: '2026-10-13T09:00:01.000Z' })])
    fireEvent.click(screen.getByRole('tab', { name: /Decided/ }))

    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument()
  })

  it('offers a campaign filter only when events span several campaigns', () => {
    renderPage([event({})])
    expect(screen.queryByLabelText('Campaign')).not.toBeInTheDocument()
    cleanup()

    renderPage([event({}), event({ id: 'ev2', campaignId: 'camp-2', question: 'Other campaign?' })])
    expect(screen.getByLabelText('Campaign')).toBeInTheDocument()
    expect(screen.getByText('Other campaign?')).toBeInTheDocument()
  })

  it('keeps settled events in history without actions', () => {
    renderPage([
      event({ id: 'a', status: 'applied', question: 'Applied one', decision: decided, outcome: 'merged into main' }),
      event({ id: 'w', status: 'withdrawn', question: 'Withdrawn one', withdrawReason: 'lane dropped' }),
      event({ id: 'c', status: 'closed', question: 'Closed one', closeReason: 'not needed' }),
    ])
    expect(screen.getByText('Nothing is waiting on you')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /History/ }))

    expect(screen.getByText('merged into main')).toBeInTheDocument()
    expect(screen.getByText('lane dropped')).toBeInTheDocument()
    expect(screen.getByText('not needed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Decide' })).not.toBeInTheDocument()
  })
})
