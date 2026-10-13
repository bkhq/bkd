import type { DecisionEvent } from '@bkd/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { handleUpdate, syncEvent } from '@/decisions/telegram'
import { parseCallback, renderEvent } from '@/decisions/telegram/render'
import { createTestProject, expectError, expectSuccess, get, patch, post } from './helpers'
import './setup'

const TOKEN = '123456:test-token'
const CHAT_ID = '-1001234'
const BASE = '/api/decisions/events'

interface TelegramCall {
  method: string
  body: Record<string, any>
}

const calls: TelegramCall[] = []
const realFetch = globalThis.fetch
let nextMessageId = 100

let projectId: string
let coordinatorId: string
let webhookId: string

function callsOf(method: string): TelegramCall[] {
  return calls.filter(c => c.method === method)
}

function lastCall(method: string): TelegramCall {
  return callsOf(method).at(-1)!
}

async function createIssue(title: string): Promise<string> {
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title,
      statusId: 'todo',
      engineType: 'codex',
      model: 'auto',
    }),
  )
  return issue.id
}

/** Create an event and post it to the chat; returns the event and its Telegram message id. */
async function announce(overrides: Record<string, unknown> = {}) {
  const event = expectSuccess(
    await post<DecisionEvent>(BASE, {
      campaignId: 'camp-tg',
      question: 'Merge the storage rewrite now?',
      context: 'apps/api/src/db/index.ts:10-40',
      options: [
        { id: 'A', label: 'Merge now', impact: 'unblocks lane 2' },
        { id: 'B', label: 'Wait for review', impact: 'one more day' },
      ],
      recommendation: { optionId: 'A', reason: 'tests are green' },
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinatorId },
      ...overrides,
    }),
  )
  await syncEvent(event.id)
  return { event, messageId: nextMessageId - 1 }
}

async function fetchEvent(id: string): Promise<DecisionEvent> {
  return expectSuccess(await get<DecisionEvent>(`${BASE}/${id}`))
}

/** Callback data of the button whose text starts with `label`, read from the last drawn keyboard. */
function button(label: string): string {
  const drawn = [...calls].reverse().find(c => c.body.reply_markup?.inline_keyboard?.length)!
  const buttons = (drawn.body.reply_markup.inline_keyboard as { text: string, callback_data: string }[][]).flat()
  const found = buttons.find(b => b.text.startsWith(label))
  if (!found) throw new Error(`no button "${label}" in ${buttons.map(b => b.text).join(', ')}`)
  return found.callback_data
}

let updateId = 1

function press(data: string, messageId: number, opts: { chatId?: string, username?: string } = {}) {
  return handleUpdate(TOKEN, {
    update_id: updateId++,
    callback_query: {
      id: `cq-${updateId}`,
      from: { id: 42, is_bot: false, username: opts.username ?? 'roy' },
      message: { message_id: messageId, chat: { id: Number(opts.chatId ?? CHAT_ID) } },
      data,
    },
  })
}

function reply(text: string, messageId: number, opts: { chatId?: string } = {}) {
  return handleUpdate(TOKEN, {
    update_id: updateId++,
    message: {
      message_id: 9000 + updateId,
      from: { id: 42, is_bot: false, username: 'roy' },
      chat: { id: Number(opts.chatId ?? CHAT_ID) },
      text,
      reply_to_message: { message_id: messageId },
    },
  })
}

beforeAll(async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const match = url.match(/^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/)
    if (!match) return realFetch(input as any, init)
    const body = JSON.parse(String(init?.body ?? '{}'))
    calls.push({ method: match[2]!, body })
    const result = match[2] === 'sendMessage' ? { message_id: nextMessageId++ } : true
    return Response.json({ ok: true, result })
  }) as typeof fetch

  projectId = await createTestProject('Decision Telegram Test')
  coordinatorId = await createIssue('Coordinator')
  const webhook = expectSuccess(
    await post<{ id: string, interactive: boolean }>('/api/settings/webhooks', {
      channel: 'telegram',
      url: CHAT_ID,
      secret: TOKEN,
      events: [],
      interactive: true,
    }),
  )
  expect(webhook.interactive).toBe(true)
  webhookId = webhook.id
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await patch(`/api/settings/webhooks/${webhookId}`, { isActive: false })
})

beforeEach(() => {
  calls.length = 0
})

describe('render', () => {
  const event = {
    id: 'ev123456',
    status: 'open',
    campaignId: 'c',
    ref: null,
    question: 'Ship <now> & here?',
    context: 'x'.repeat(30_000),
    options: [
      { id: 'A', label: 'Yes', impact: 'fast' },
      { id: 'B', label: 'No', impact: '' },
    ],
    recommendation: { optionId: 'B', reason: 'safer' },
    blocks: null,
    continues: null,
    notify: { type: 'bkd-follow-up', projectId: 'p', issueId: 'i' },
    decision: null,
    outcome: null,
    withdrawReason: null,
    closeReason: null,
    notifiedAt: null,
    links: { projectName: 'Demo', ref: null, notify: null },
    createdAt: '2026-10-13T10:00:00.000Z',
    updatedAt: '2026-10-13T10:00:00.000Z',
  } as DecisionEvent

  test('escapes HTML and stays inside the Telegram length limit', () => {
    const { text } = renderEvent(event, null)
    expect(text).toContain('Ship &lt;now&gt; &amp; here?')
    expect(text.length).toBeLessThanOrEqual(4096)
  })

  test('still fits when every option is at its maximum size', () => {
    const options = Array.from({ length: 20 }, (_, i) => ({
      id: `opt-${i}`,
      label: 'l'.repeat(500),
      impact: 'i'.repeat(2000),
    }))
    const { text } = renderEvent({ ...event, options, recommendation: null }, null)
    expect(text.length).toBeLessThanOrEqual(4096)
  })

  test('draws one button per option plus close, each within 64 bytes', () => {
    const { reply_markup } = renderEvent(event, null)
    const buttons = reply_markup.inline_keyboard.flat()
    expect(buttons.map(b => b.text)).toEqual(['A', 'B ⭐', 'Close'])
    for (const b of buttons) expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64)
    expect(parseCallback(buttons[1]!.callback_data)).toMatchObject({ action: 'pick', eventId: 'ev123456', index: 1 })
  })

  test('removes the keyboard once the event is settled', () => {
    const decided = {
      ...event,
      status: 'decided',
      decision: { optionId: 'A', instruction: 'go', decidedBy: 'telegram:roy', decidedAt: event.createdAt },
    } as DecisionEvent
    const { text, reply_markup } = renderEvent(decided, null)
    expect(reply_markup.inline_keyboard).toEqual([])
    expect(text).toContain('telegram:roy')
    expect(text).toContain('Yes')
  })

  test('rejects malformed callback data', () => {
    expect(parseCallback('nonsense')).toBeNull()
    expect(parseCallback('d:ev123456:notanumber:abc')).toBeNull()
  })
})

describe('webhook settings', () => {
  test('rejects interactive on a plain webhook and an empty event list without it', async () => {
    expectError(
      await post('/api/settings/webhooks', {
        channel: 'webhook',
        url: 'https://example.com/hook',
        events: ['issue.created'],
        interactive: true,
      }),
      400,
    )
    expectError(
      await post('/api/settings/webhooks', { channel: 'telegram', url: CHAT_ID, secret: TOKEN, events: [] }),
      400,
    )
  })
})

describe('announce', () => {
  test('posts an open event once and redraws it when the raiser edits it', async () => {
    const { event, messageId } = await announce()
    expect(callsOf('sendMessage')).toHaveLength(1)
    expect(lastCall('sendMessage').body.chat_id).toBe(CHAT_ID)
    expect(lastCall('sendMessage').body.text).toContain('Merge the storage rewrite now?')

    expectSuccess(await patch(`${BASE}/${event.id}`, { question: 'Merge it today?' }))
    await syncEvent(event.id)
    expect(callsOf('sendMessage')).toHaveLength(1)
    expect(lastCall('editMessageText').body.message_id).toBe(messageId)
    expect(lastCall('editMessageText').body.text).toContain('Merge it today?')
  })

  test('shows a decision made in the inbox and drops the buttons', async () => {
    const { event, messageId } = await announce()
    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'B' }))
    await syncEvent(event.id)

    const edit = lastCall('editMessageText')
    expect(edit.body.message_id).toBe(messageId)
    expect(edit.body.text).toContain('Wait for review')
    expect(edit.body.reply_markup.inline_keyboard).toEqual([])
  })

  test('does not post an event that was settled before it was ever announced', async () => {
    const event = expectSuccess(
      await post<DecisionEvent>(BASE, {
        campaignId: 'camp-tg',
        question: 'Never shown',
        notify: { type: 'bkd-follow-up', projectId, issueId: coordinatorId },
      }),
    )
    expectSuccess(await post(`${BASE}/${event.id}/close`, { reason: 'moot' }))
    await syncEvent(event.id)
    expect(calls).toHaveLength(0)
  })
})

describe('answer with a button', () => {
  test('asks for confirmation, then decides and wakes the notify issue', async () => {
    const coordinator = await createIssue('Coordinator button')
    const { event, messageId } = await announce({
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinator },
    })

    await press(button('B'), messageId)
    expect((await fetchEvent(event.id)).status).toBe('open')

    await press(button('Confirm'), messageId)
    const decided = await fetchEvent(event.id)
    expect(decided.status).toBe('decided')
    expect(decided.decision).toMatchObject({ optionId: 'B', instruction: '', decidedBy: 'telegram:roy' })
    expect(decided.notifiedAt).toBeTruthy()
    expect(callsOf('answerCallbackQuery').length).toBeGreaterThanOrEqual(2)

    const pending = expectSuccess(
      await get<{ content: string }[]>(`/api/projects/${projectId}/issues/${coordinator}/pending`),
    )
    expect(pending.map(p => p.content)).toEqual([`[event-decision eventId=${event.id} campaignId=camp-tg]`])
  })

  test('back returns to the option buttons without deciding', async () => {
    const { event, messageId } = await announce()
    await press(button('A'), messageId)
    await press(button('Back'), messageId)
    expect(button('A')).toStartWith('d:')
    expect((await fetchEvent(event.id)).status).toBe('open')
  })

  test('ignores a press from another chat', async () => {
    const { event, messageId } = await announce()
    const pick = button('A')
    await press(pick, messageId, { chatId: '-999' })
    await press(pick.replace(/^d:/, 'c:'), messageId, { chatId: '-999' })
    expect((await fetchEvent(event.id)).status).toBe('open')
    expect(callsOf('answerCallbackQuery')).toHaveLength(0)
  })

  test('refuses a button drawn before the raiser changed the options', async () => {
    const { event, messageId } = await announce()
    const stale = button('A').replace(/^d:/, 'c:')
    expectSuccess(
      await patch(`${BASE}/${event.id}`, {
        options: [{ id: 'Z', label: 'Something else', impact: '' }],
        recommendation: null,
      }),
    )

    await press(stale, messageId)
    expect((await fetchEvent(event.id)).status).toBe('open')
    expect(lastCall('editMessageText').body.text).toContain('Something else')
  })

  test('a second confirm after the decision changes nothing', async () => {
    const { event, messageId } = await announce()
    await press(button('A'), messageId)
    const confirm = button('Confirm')
    await press(confirm, messageId)
    await press(confirm, messageId, { username: 'mallory' })
    expect((await fetchEvent(event.id)).decision?.decidedBy).toBe('telegram:roy')
  })

  test('close needs confirmation and sends no follow-up', async () => {
    const coordinator = await createIssue('Coordinator close')
    const { event, messageId } = await announce({
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinator },
    })
    await press(button('Close'), messageId)
    expect((await fetchEvent(event.id)).status).toBe('open')
    await press(button('Confirm'), messageId)
    expect((await fetchEvent(event.id)).status).toBe('closed')

    const pending = expectSuccess(
      await get<unknown[]>(`/api/projects/${projectId}/issues/${coordinator}/pending`),
    )
    expect(pending).toEqual([])
  })
})

describe('answer with a reply', () => {
  test('a reply to the event message becomes the instruction', async () => {
    const { event, messageId } = await announce()
    await reply('  Split it into two migrations  ', messageId)
    const decided = await fetchEvent(event.id)
    expect(decided.status).toBe('decided')
    expect(decided.decision).toMatchObject({
      optionId: null,
      instruction: 'Split it into two migrations',
      decidedBy: 'telegram:roy',
    })
  })

  test('ignores a reply from another chat and a reply to an unrelated message', async () => {
    const { event, messageId } = await announce()
    await reply('do it', messageId, { chatId: '-999' })
    await reply('do it', 555_555)
    expect((await fetchEvent(event.id)).status).toBe('open')
  })

  test('tells the user when the event was already settled', async () => {
    const { event, messageId } = await announce()
    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'A' }))
    calls.length = 0
    await reply('too late', messageId)
    expect((await fetchEvent(event.id)).decision?.instruction).toBe('')
    expect(callsOf('sendMessage')).toHaveLength(1)
    expect(lastCall('sendMessage').body.reply_to_message_id).toBeDefined()
  })
})
