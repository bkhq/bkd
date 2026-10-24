import type { Message } from '@bkd/shared'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { MessagesInbox } from '@/components/messages/MessagesInbox'

const mocks = vi.hoisted(() => ({
  events: [] as unknown[],
  decide: vi.fn(),
  close: vi.fn(),
  notify: vi.fn(),
  reply: vi.fn(),
  read: vi.fn(),
  readAll: vi.fn(),
}))

function event(overrides: Partial<Message>): Message {
  return {
    id: 'ev1',
    kind: 'decision',
    expects: 'reply',
    status: 'open',
    level: 'info',
    campaignId: 'camp-1',
    source: { projectId: 'p1', issueId: 'i1' },
    ref: 'i2',
    title: 'Merge the storage rewrite now?',
    body: 'apps/api/src/db/index.ts:10-40',
    options: [
      { id: 'A', label: 'Merge now', impact: 'unblocks lane 2' },
      { id: 'B', label: 'Wait for review', impact: 'one more day' },
    ],
    recommendation: { optionId: 'A', reason: 'tests are green' },
    blocks: 'lane 2',
    continues: 'lane 3',
    decision: null,
    reply: null,
    outcome: null,
    withdrawReason: null,
    closeReason: null,
    notifiedAt: null,
    links: {
      projectName: 'Fleet',
      ref: { issueId: 'i2', projectId: 'p1', issueNumber: 12, title: 'Storage lane' },
      source: { issueId: 'i1', projectId: 'p1', issueNumber: 3, title: 'Coordinator' },
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

vi.mock('@/components/issue-detail/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}))
vi.mock('@/hooks/use-messages', () => ({
  useMessages: () => ({ data: mocks.events, isLoading: false }),
  useDecideMessage: () => ({ mutate: mocks.decide, isPending: false, error: null }),
  useReplyMessage: () => ({ mutate: mocks.reply, isPending: false, error: null }),
  useCloseMessage: () => ({ mutate: mocks.close, reset: vi.fn(), isPending: false, error: null }),
  useNotifyMessage: () => ({ mutate: mocks.notify, isPending: false, error: null }),
  useReadMessage: () => ({ mutate: mocks.read, isPending: false, error: null }),
  useReadAllMessages: () => ({ mutate: mocks.readAll, isPending: false, error: null }),
}))

function renderPage(events: Message[]) {
  mocks.events = events
  render(
    <MemoryRouter>
      <MessagesInbox />
    </MemoryRouter>,
  )
}

function notification(overrides: Partial<Message>): Message {
  return event({
    id: 'n1',
    kind: 'notification',
    expects: 'none',
    status: 'unread',
    level: 'success',
    title: 'Staging deploy finished',
    body: 'All checks green.',
    options: [],
    recommendation: null,
    blocks: null,
    continues: null,
    ...overrides,
  })
}

describe('messages inbox', () => {
  beforeEach(async () => {
    for (const fn of [mocks.decide, mocks.close, mocks.notify, mocks.reply, mocks.read, mocks.readAll]) fn.mockReset()
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
      event({ id: 'ev2', status: 'decided', title: 'Ship it?', decision: decided }),
    ])
    expect(screen.queryByText('Ship it?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Answered/ }))

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
    fireEvent.click(screen.getByRole('tab', { name: /Answered/ }))

    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument()
  })

  it('offers a campaign filter only when events span several campaigns', () => {
    renderPage([event({})])
    expect(screen.queryByLabelText('Campaign')).not.toBeInTheDocument()
    cleanup()

    renderPage([event({}), event({ id: 'ev2', campaignId: 'camp-2', title: 'Other campaign?' })])
    expect(screen.getByLabelText('Campaign')).toBeInTheDocument()
    expect(screen.getByText('Other campaign?')).toBeInTheDocument()
  })

  it('keeps settled events in history without actions', () => {
    renderPage([
      event({ id: 'a', status: 'applied', title: 'Applied one', decision: decided, outcome: 'merged into main' }),
      event({ id: 'w', status: 'withdrawn', title: 'Withdrawn one', withdrawReason: 'lane dropped' }),
      event({ id: 'c', status: 'closed', title: 'Closed one', closeReason: 'not needed' }),
    ])
    expect(screen.getByText('Nothing is waiting on you')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /History/ }))

    expect(screen.getByText('merged into main')).toBeInTheDocument()
    expect(screen.getByText('lane dropped')).toBeInTheDocument()
    expect(screen.getByText('not needed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Decide' })).not.toBeInTheDocument()
  })

  it('shows an unread notification with its source and marks it read', () => {
    renderPage([notification({})])

    expect(screen.getByText('Staging deploy finished')).toBeInTheDocument()
    expect(screen.getByText('All checks green.')).toBeInTheDocument()
    expect(screen.getByText('Unread')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#3 Coordinator' })).toHaveAttribute('href', '/projects/p1/issues/i1')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }))
    expect(mocks.read).toHaveBeenCalledWith('n1')

    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(mocks.readAll).toHaveBeenCalled()
  })

  it('replies to a notification awaiting a reply', () => {
    renderPage([notification({ expects: 'reply', status: 'open', title: 'Which region?' })])
    const send = screen.getByRole('button', { name: 'Send reply' })
    expect(send).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Mark read' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: ' eu-west-1 ' } })
    fireEvent.click(send)

    expect(mocks.reply).toHaveBeenCalledWith({ id: 'n1', text: 'eu-west-1' })
  })

  it('shows a reply under answered with a resend when the agent was not woken', () => {
    renderPage([notification({
      expects: 'reply',
      status: 'replied',
      reply: { text: 'eu-west-1', repliedBy: 'user', repliedAt: '2026-10-13T09:00:00.000Z' },
    })])
    fireEvent.click(screen.getByRole('tab', { name: /Answered/ }))

    expect(screen.getByText('eu-west-1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
    expect(mocks.notify).toHaveBeenCalledWith('n1')
  })

  it('read notifications go to history', () => {
    renderPage([notification({ status: 'read' })])
    expect(screen.queryByText('Staging deploy finished')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /History/ }))
    expect(screen.getByText('Staging deploy finished')).toBeInTheDocument()
  })
})
