import type { DecisionEvent, Message } from '@bkd/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { resetSendLimits } from '@/messages/service'
import { dispatchMessage } from '@/webhooks/dispatcher'
import { createTestProject, expectSuccess, patch, post } from './helpers'
import './setup'

const HOOK_URL = 'http://127.0.0.1:9/decision-hook'
const TOKEN = '654321:notify-token'
const BASE = '/api/decisions/events'

interface Captured {
  url: string
  headers: Record<string, string>
  body: Record<string, any>
  redirect?: RequestRedirect
}

const calls: Captured[] = []
const realFetch = globalThis.fetch
const webhookIds: string[] = []

let projectId: string
let coordinatorId: string

function hookCalls(): Captured[] {
  return calls.filter(c => c.url === HOOK_URL)
}

function telegramCalls(): Captured[] {
  return calls.filter(c => c.url.includes(`/bot${TOKEN}/`))
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(10)
}

/** Deliveries are fire-and-forget; give one that should not happen time to show up. */
async function settle(): Promise<void> {
  await Bun.sleep(80)
}

async function createEvent(): Promise<DecisionEvent> {
  return expectSuccess(
    await post<DecisionEvent>(BASE, {
      campaignId: 'camp-hook',
      question: 'Ship the release today?',
      options: [
        { id: 'A', label: 'Ship', impact: 'today' },
        { id: 'B', label: 'Hold', impact: 'next week' },
      ],
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinatorId },
    }),
  )
}

async function addWebhook(body: Record<string, unknown>): Promise<void> {
  const webhook = expectSuccess(await post<{ id: string }>('/api/settings/webhooks', body))
  webhookIds.push(webhook.id)
}

beforeAll(async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url !== HOOK_URL && !url.includes(`/bot${TOKEN}/`)) return realFetch(input as any, init)
    calls.push({
      url,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')),
      redirect: init?.redirect,
    })
    return Response.json({ ok: true, result: { message_id: 1 } })
  }) as typeof fetch

  projectId = await createTestProject('Decision Webhook Test')
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'Coordinator',
      statusId: 'todo',
      engineType: 'codex',
      model: 'auto',
    }),
  )
  coordinatorId = issue.id

  await addWebhook({
    channel: 'webhook',
    url: HOOK_URL,
    secret: 'hook-key',
    events: ['decision.opened', 'decision.decided', 'message.sent', 'message.replied'],
  })
  await addWebhook({ channel: 'telegram', url: '-200', secret: TOKEN, events: ['decision.opened', 'message.sent'] })
  // Interactive chats get messages awaiting a reply from the bot, not as a plain notification.
  await addWebhook({
    channel: 'telegram',
    url: '-300',
    secret: TOKEN,
    events: ['decision.opened', 'message.sent'],
    interactive: true,
  })
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await patch('/api/settings/server-info', { url: '' })
  for (const id of webhookIds) await patch(`/api/settings/webhooks/${id}`, { isActive: false })
})

beforeEach(() => {
  calls.length = 0
})

describe('decision notification events', () => {
  test('a new event is delivered to a local webhook with its details and links', async () => {
    expectSuccess(await patch('/api/settings/server-info', { url: 'https://bkd.example.com/' }))
    const event = await createEvent()
    await dispatchMessage(event.id)
    await waitFor(() => hookCalls().length > 0)

    expect(hookCalls()).toHaveLength(1)
    const { headers, body } = hookCalls()[0]!
    expect(headers['X-Webhook-Event']).toBe('decision.opened')
    expect(headers.Authorization).toBe('Bearer hook-key')
    expect(body).toMatchObject({
      event: 'decision.opened',
      id: event.id,
      status: 'open',
      question: 'Ship the release today?',
      decisionsUrl: 'https://bkd.example.com/decisions',
      apiUrl: `https://bkd.example.com/api/decisions/events/${event.id}`,
    })
    expect(body.options).toHaveLength(2)
    // A redirect could lead to an address the URL check blocks, so none is followed.
    expect(hookCalls()[0]!.redirect).toBe('manual')
    expect(body.timestamp).toBeTruthy()
  })

  test('a plain Telegram channel gets the question, an interactive one does not', async () => {
    const event = await createEvent()
    await dispatchMessage(event.id)
    await waitFor(() => telegramCalls().length > 0)
    await settle()

    expect(telegramCalls()).toHaveLength(1)
    const { body } = telegramCalls()[0]!
    expect(body.chat_id).toBe('-200')
    expect(body.text).toContain('Ship the release today?')
    expect(body.text).not.toContain('Reply to this message')
    expect(body.reply_markup).toBeUndefined()
  })

  test('an edit of an open event is not announced again', async () => {
    const event = await createEvent()
    await dispatchMessage(event.id)
    await waitFor(() => hookCalls().length > 0)

    expectSuccess(await patch(`${BASE}/${event.id}`, { context: 'more detail' }))
    await dispatchMessage(event.id)
    await settle()
    expect(hookCalls()).toHaveLength(1)
  })

  test('a decision is delivered with the answer; an unsubscribed transition is not', async () => {
    const decided = await createEvent()
    expectSuccess(await post(`${BASE}/${decided.id}/decision`, { optionId: 'B', instruction: 'after QA' }))
    await dispatchMessage(decided.id)
    await waitFor(() => hookCalls().length > 0)

    expect(hookCalls()).toHaveLength(1)
    expect(hookCalls()[0]!.body).toMatchObject({
      event: 'decision.decided',
      id: decided.id,
      decision: { optionId: 'B', instruction: 'after QA', decidedBy: 'user' },
    })

    calls.length = 0
    const closed = await createEvent()
    expectSuccess(await post(`${BASE}/${closed.id}/close`, { reason: 'moot' }))
    await dispatchMessage(closed.id)
    await settle()
    expect(calls).toHaveLength(0)
  })
})

async function sendNotification(overrides: Record<string, unknown> = {}): Promise<Message> {
  resetSendLimits()
  return expectSuccess(
    await post<Message>('/api/messages/items', {
      kind: 'notification',
      title: 'Staging deploy finished',
      body: 'All checks green.',
      level: 'success',
      campaignId: 'camp-hook',
      source: { projectId, issueId: coordinatorId },
      ...overrides,
    }),
  )
}

describe('notification messages', () => {
  test('a notification is delivered with the message, its source issue, links and server', async () => {
    expectSuccess(await patch('/api/settings/server-info', { url: 'https://bkd.example.com/' }))
    const message = await sendNotification()
    await dispatchMessage(message.id)
    await waitFor(() => hookCalls().length > 0)

    expect(hookCalls()).toHaveLength(1)
    const { headers, body } = hookCalls()[0]!
    expect(headers['X-Webhook-Event']).toBe('message.sent')
    expect(body).toMatchObject({
      event: 'message.sent',
      message: {
        id: message.id,
        kind: 'notification',
        expects: 'none',
        level: 'success',
        status: 'unread',
        title: 'Staging deploy finished',
        body: 'All checks green.',
        campaignId: 'camp-hook',
      },
      source: {
        issueId: coordinatorId,
        projectId,
        projectName: 'Decision Webhook Test',
        title: 'Coordinator',
        engineType: 'codex',
        issueUrl: `https://bkd.example.com/projects/${projectId}/issues/${coordinatorId}`,
      },
      ref: null,
      links: {
        inboxUrl: 'https://bkd.example.com/messages',
        apiUrl: `https://bkd.example.com/api/messages/items/${message.id}`,
      },
      server: { url: 'https://bkd.example.com' },
    })
    expect(body.source.issueNumber).toBeNumber()
    expect(body.server.version).toBeString()
    expect(body.message.links).toBeUndefined()
  })

  test('a plain notification reaches every subscribed chat, interactive ones included', async () => {
    const message = await sendNotification()
    await dispatchMessage(message.id)
    await waitFor(() => telegramCalls().length >= 2)
    await settle()

    expect(telegramCalls().map(c => c.body.chat_id).sort()).toEqual(['-200', '-300'])
    expect(telegramCalls()[0]!.body.text).toStartWith('✅ <b>Staging deploy finished</b>')
  })

  test('a notification awaiting a reply skips interactive chats and says it awaits one', async () => {
    const message = await sendNotification({ expects: 'reply', title: 'Deploy to production?' })
    await dispatchMessage(message.id)
    await waitFor(() => telegramCalls().length > 0)
    await settle()

    expect(telegramCalls()).toHaveLength(1)
    expect(telegramCalls()[0]!.body.chat_id).toBe('-200')
    expect(telegramCalls()[0]!.body.text).toContain('Awaiting a reply')
    expect(hookCalls()[0]!.body.message.expects).toBe('reply')
  })

  test('a reply is delivered once; marking read is not announced', async () => {
    const asked = await sendNotification({ expects: 'reply' })
    expectSuccess(await post(`/api/messages/items/${asked.id}/reply`, { text: 'go ahead' }))
    await dispatchMessage(asked.id)
    await dispatchMessage(asked.id)
    await waitFor(() => hookCalls().length > 0)
    await settle()
    expect(hookCalls()).toHaveLength(1)
    expect(hookCalls()[0]!.body).toMatchObject({
      event: 'message.replied',
      message: { status: 'replied', reply: { text: 'go ahead', repliedBy: 'user' } },
    })

    calls.length = 0
    const plain = await sendNotification()
    expectSuccess(await post(`/api/messages/items/${plain.id}/read`, {}))
    await dispatchMessage(plain.id)
    await settle()
    expect(calls).toHaveLength(0)
  })
})
