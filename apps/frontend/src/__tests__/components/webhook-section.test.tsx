import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebhookSection } from '@/components/settings/WebhookSection'
import i18n from '@/i18n'
import type { Webhook } from '@/types/kanban'

const mocks = vi.hoisted(() => ({
  webhooks: [] as Webhook[],
  create: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/hooks/use-kanban', async (importOriginal) => {
  const mutation = { mutate: vi.fn(), isPending: false }
  return {
    ...await importOriginal<typeof import('@/hooks/use-kanban')>(),
    useWebhooks: () => ({ data: mocks.webhooks, isLoading: false }),
    useWebhookDeliveries: () => ({ data: [], isLoading: false }),
    useCreateWebhook: () => ({ mutate: mocks.create, isPending: false }),
    useDeleteWebhook: () => ({ mutate: mocks.remove, isPending: false }),
    useUpdateWebhook: () => mutation,
    useTestWebhook: () => mutation,
  }
})

function webhook(overrides: Partial<Webhook>): Webhook {
  return {
    id: 'w1',
    channel: 'webhook',
    url: 'https://example.com/hook',
    secret: null,
    events: ['issue.created', 'issue.status.review'],
    isActive: true,
    interactive: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('webhook section', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.webhooks = []
    mocks.create.mockReset()
    mocks.remove.mockReset()
  })

  it('summarizes each channel with its event count', () => {
    mocks.webhooks = [webhook({}), webhook({ id: 'w2', channel: 'browser', url: '', events: ['message.sent'] })]
    render(<WebhookSection open />)
    expect(screen.getByText('https://example.com/hook')).toBeInTheDocument()
    expect(screen.getByText('Browser')).toBeInTheDocument()
    expect(screen.getByText(/^2 events/)).toBeInTheDocument()
    expect(screen.getByText(/^1 event · Sent/)).toBeInTheDocument()
  })

  it('creates a browser channel without a URL', () => {
    render(<WebhookSection open />)
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Browser' }))
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'browser', url: '' }),
      expect.anything(),
    )
  })

  it('saves the events left selected', () => {
    render(<WebhookSection open />)
    fireEvent.click(screen.getByRole('button', { name: /Add/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Browser' }))
    fireEvent.click(screen.getByRole('button', { name: 'Created' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const { events } = mocks.create.mock.calls[0]![0] as { events: string[] }
    expect(events).not.toContain('issue.created')
    expect(events).toContain('issue.updated')
  })

  it('asks before deleting a channel', () => {
    mocks.webhooks = [webhook({})]
    render(<WebhookSection open />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.remove).toHaveBeenCalledWith('w1', expect.anything())
  })
})
