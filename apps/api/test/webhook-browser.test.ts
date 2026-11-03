import type { BrowserNotificationEvent, Message, Webhook } from '@bkd/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { appEvents } from '@/events'
import { resetSendLimits } from '@/messages/service'
import { dispatch, dispatchMessage } from '@/webhooks/dispatcher'
import { createTestProject, expectSuccess, patch, post } from './helpers'
import './setup'

const received: BrowserNotificationEvent[] = []
let unsubscribe: () => void
let webhook: Webhook
let projectId: string
let issueId: string

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(10)
}

beforeAll(async () => {
  unsubscribe = appEvents.on('browser-notification', (data) => {
    if (data.webhookId === webhook?.id) received.push(data)
  })
  projectId = await createTestProject('Browser Channel Test')
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, { title: 'Fix login', statusId: 'todo' }),
  )
  issueId = issue.id
  webhook = expectSuccess(await post<Webhook>('/api/settings/webhooks', {
    channel: 'browser',
    url: 'ignored',
    secret: 'ignored',
    events: ['issue.status.review', 'message.sent', 'decision.opened'],
  }))
})

afterAll(async () => {
  unsubscribe()
  await patch(`/api/settings/webhooks/${webhook.id}`, { isActive: false })
})

beforeEach(() => {
  received.length = 0
})

describe('browser notification channel', () => {
  test('is created without a target or secret', () => {
    expect(webhook.channel).toBe('browser')
    expect(webhook.url).toBe('')
    expect(webhook.secret).toBeNull()
  })

  test('an empty URL is still rejected for a webhook channel', async () => {
    const res = await post('/api/settings/webhooks', { channel: 'webhook', url: '', events: ['issue.created'] })
    expect(res.status).toBe(400)
  })

  test('a subscribed issue event is pushed with the issue and its project', async () => {
    await dispatch('issue.status.review', {
      event: 'issue.status.review',
      issueId,
      projectId,
      projectName: 'Browser Channel Test',
      title: 'Fix login',
    })
    await waitFor(() => received.length > 0)
    expect(received).toEqual([{
      webhookId: webhook.id,
      event: 'issue.status.review',
      title: 'Fix login',
      projectName: 'Browser Channel Test',
      projectId,
      issueId,
      messageId: null,
    }])
  })

  test('an unsubscribed event is not pushed', async () => {
    await dispatch('issue.status.done', { event: 'issue.status.done', issueId, projectId, title: 'Fix login' })
    await Bun.sleep(80)
    expect(received).toHaveLength(0)
  })

  test('a notification message is pushed with its title and id', async () => {
    resetSendLimits()
    const message = expectSuccess(await post<Message>('/api/messages/items', {
      kind: 'notification',
      title: 'Staging deploy finished',
      body: 'All checks green.',
      source: { projectId, issueId },
    }))
    await dispatchMessage(message.id)
    await waitFor(() => received.length > 0)
    expect(received[0]).toMatchObject({
      event: 'message.sent',
      title: 'Staging deploy finished',
      projectName: 'Browser Channel Test',
      messageId: message.id,
      issueId: null,
    })
  })
})
