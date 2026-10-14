import type { DecisionEvent } from '@bkd/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { dispatchDecisionEvent } from '@/webhooks/dispatcher'
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
    events: ['decision.opened', 'decision.decided'],
  })
  await addWebhook({ channel: 'telegram', url: '-200', secret: TOKEN, events: ['decision.opened'] })
  // Interactive chats get the event from the decision bot, not as a plain notification.
  await addWebhook({ channel: 'telegram', url: '-300', secret: TOKEN, events: ['decision.opened'], interactive: true })
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
    await dispatchDecisionEvent(event.id)
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
    await dispatchDecisionEvent(event.id)
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
    await dispatchDecisionEvent(event.id)
    await waitFor(() => hookCalls().length > 0)

    expectSuccess(await patch(`${BASE}/${event.id}`, { context: 'more detail' }))
    await dispatchDecisionEvent(event.id)
    await settle()
    expect(hookCalls()).toHaveLength(1)
  })

  test('a decision is delivered with the answer; an unsubscribed transition is not', async () => {
    const decided = await createEvent()
    expectSuccess(await post(`${BASE}/${decided.id}/decision`, { optionId: 'B', instruction: 'after QA' }))
    await dispatchDecisionEvent(decided.id)
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
    await dispatchDecisionEvent(closed.id)
    await settle()
    expect(calls).toHaveLength(0)
  })
})
