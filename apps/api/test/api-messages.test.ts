import type { DecisionEvent, Message } from '@bkd/shared'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { resetSendLimits } from '@/messages/service'
import { createTestProject, expectError, expectSuccess, get, patch, post } from './helpers'
import './setup'

const BASE = '/api/messages/items'

let projectId: string
let senderId: string
let subjectId: string

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

async function send(overrides: Record<string, unknown> = {}): Promise<Message> {
  const res = await post<Message>(BASE, {
    kind: 'notification',
    title: 'Migration finished',
    source: { projectId, issueId: senderId },
    ...overrides,
  })
  expect(res.status).toBe(201)
  return expectSuccess(res)
}

async function ask(overrides: Record<string, unknown> = {}): Promise<Message> {
  return send({ expects: 'reply', title: 'Which region?', ...overrides })
}

async function fetchMessage(id: string): Promise<Message> {
  return expectSuccess(await get<Message>(`${BASE}/${id}`))
}

async function pendingOf(issueId: string): Promise<string[]> {
  const rows = expectSuccess(
    await get<{ content: string }[]>(`/api/projects/${projectId}/issues/${issueId}/pending`),
  )
  return rows.map(r => r.content)
}

beforeAll(async () => {
  projectId = await createTestProject('Messages Test')
  senderId = await createIssue('Sender')
  subjectId = await createIssue('Subject')
})

beforeEach(() => {
  resetSendLimits()
})

describe('capability probe', () => {
  test('reports contract 2 with both kinds', async () => {
    const data = expectSuccess(await get('/api/messages'))
    expect(data).toEqual({ supported: true, contractVersion: 2, kinds: ['decision', 'notification'] })
  })
})

describe('notifications', () => {
  test('a plain notification is stored unread with its links', async () => {
    const message = await send({ ref: subjectId, level: 'warning', body: '**3** tables', campaignId: 'camp-m' })
    expect(message).toMatchObject({
      kind: 'notification',
      expects: 'none',
      status: 'unread',
      level: 'warning',
      body: '**3** tables',
      campaignId: 'camp-m',
      source: { projectId, issueId: senderId },
      decision: null,
      reply: null,
    })
    expect(message.links.projectName).toBe('Messages Test')
    expect(message.links.source?.title).toBe('Sender')
    expect(message.links.ref?.title).toBe('Subject')
  })

  test('needs no source unless it expects a reply', async () => {
    const anonymous = await send({ source: undefined })
    expect(anonymous.source).toBeNull()
    expect(anonymous.links.source).toBeNull()

    expectError(await post(BASE, { kind: 'notification', expects: 'reply', title: 'Hm?' }), 400)
  })

  test('rejects a source issue outside the source project', async () => {
    const other = await createTestProject('Messages Other')
    expectError(await post(BASE, {
      kind: 'notification',
      title: 'x',
      source: { projectId: other, issueId: senderId },
    }), 400)
  })

  test('rejects an unknown kind and an empty title', async () => {
    expectError(await post(BASE, { kind: 'memo', title: 'x' }), 400)
    expectError(await post(BASE, { kind: 'notification', title: '  ' }), 400)
  })

  test('marks one read, then all of them', async () => {
    const one = await send()
    const two = await send()
    const read = expectSuccess(await post<Message>(`${BASE}/${one.id}/read`, {}))
    expect(read.status).toBe('read')

    const { ids } = expectSuccess(await post<{ ids: string[] }>(`${BASE}/read`, {}))
    expect(ids).toContain(two.id)
    expect(ids).not.toContain(one.id)
    expect((await fetchMessage(two.id)).status).toBe('read')
  })

  test('limits one issue to 30 notifications a minute', async () => {
    for (let i = 0; i < 30; i++) await send()
    expectError(
      await post(BASE, { kind: 'notification', title: 'one more', source: { projectId, issueId: senderId } }),
      429,
    )
    // Another sender is unaffected.
    await send({ source: { projectId, issueId: subjectId } })
  })
})

describe('notifications awaiting a reply', () => {
  test('a reply wakes the source issue, which reads it and acks', async () => {
    const sender = await createIssue('Reply Sender')
    const message = await ask({ source: { projectId, issueId: sender }, campaignId: 'camp-r' })
    expect(message.status).toBe('open')

    const replied = expectSuccess(
      await post<Message>(`${BASE}/${message.id}/reply`, { text: '  eu-west-1  ', repliedBy: 'roy' }),
    )
    expect(replied.status).toBe('replied')
    expect(replied.reply).toMatchObject({ text: 'eu-west-1', repliedBy: 'roy' })
    expect(replied.notifiedAt).not.toBeNull()
    expect(await pendingOf(sender)).toContain(`[message-reply messageId=${message.id} campaignId=camp-r]`)
    const wake = expectSuccess(
      await get<{ content: string, metadata: Record<string, unknown> | null }[]>(`/api/projects/${projectId}/issues/${sender}/pending`),
    ).find(r => r.content.startsWith('[message-reply'))
    expect(wake?.metadata?.sender).toEqual({ kind: 'system', via: 'message' })

    expectError(await post(`${BASE}/${message.id}/reply`, { text: 'again' }), 409)

    const applied = expectSuccess(
      await post<Message>(`${BASE}/${message.id}/ack`, { outcome: 'deployed to eu-west-1' }),
    )
    expect(applied.status).toBe('applied')
    expect(applied.outcome).toBe('deployed to eu-west-1')
  })

  test('the wake can be resent after a reply', async () => {
    const message = await ask()
    expectError(await post(`${BASE}/${message.id}/notify`, {}), 409)
    expectSuccess(await post(`${BASE}/${message.id}/reply`, { text: 'ok' }))
    expectSuccess(await post(`${BASE}/${message.id}/notify`, {}))
  })

  test('the sender can edit and withdraw it while open; the user can close it', async () => {
    const edited = expectSuccess(
      await patch<Message>(`${BASE}/${(await ask()).id}`, { title: 'Which AWS region?', level: 'error' }),
    )
    expect(edited).toMatchObject({ title: 'Which AWS region?', level: 'error' })
    expectError(await patch(`${BASE}/${edited.id}`, { options: [{ id: 'A', label: 'a' }] }), 400)

    const withdrawn = expectSuccess(await post<Message>(`${BASE}/${edited.id}/withdraw`, { reason: 'moot' }))
    expect(withdrawn.status).toBe('withdrawn')

    const closed = expectSuccess(await post<Message>(`${BASE}/${(await ask()).id}/close`, {}))
    expect(closed.status).toBe('closed')
  })

  test('reply-flow actions do not apply to a plain notification and read does not apply here', async () => {
    const plain = await send()
    expectError(await post(`${BASE}/${plain.id}/reply`, { text: 'x' }), 409)
    expectError(await post(`${BASE}/${plain.id}/close`, {}), 409)
    expectError(await patch(`${BASE}/${plain.id}`, { title: 'x' }), 409)
    expectError(await post(`${BASE}/${(await ask()).id}/read`, {}), 409)
  })
})

describe('decisions', () => {
  function decisionBody(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'decision',
      campaignId: 'camp-d',
      ref: subjectId,
      title: 'Merge now?',
      body: 'tests are green',
      options: [{ id: 'A', label: 'Merge' }, { id: 'B', label: 'Wait' }],
      recommendation: { optionId: 'A' },
      source: { projectId, issueId: senderId },
      ...overrides,
    }
  }

  test('a decision is raised and answered through the messages API, and visible as v1', async () => {
    const sender = await createIssue('Decision Sender')
    const created = expectSuccess(
      await post<Message>(BASE, decisionBody({ source: { projectId, issueId: sender } })),
    )
    expect(created).toMatchObject({ kind: 'decision', expects: 'reply', status: 'open', title: 'Merge now?' })

    expectError(await post(`${BASE}/${created.id}/reply`, { text: 'x' }), 404)
    expectError(await post(`${BASE}/${created.id}/decision`, { optionId: 'Z' }), 400)
    const decided = expectSuccess(await post<Message>(`${BASE}/${created.id}/decision`, { optionId: 'B' }))
    expect(decided.status).toBe('decided')
    expect(await pendingOf(sender)).toContain(`[event-decision eventId=${created.id} campaignId=camp-d]`)

    const v1 = expectSuccess(await get<DecisionEvent>(`/api/decisions/events/${created.id}`))
    expect(v1).toMatchObject({
      question: 'Merge now?',
      context: 'tests are green',
      notify: { type: 'bkd-follow-up', projectId, issueId: sender },
      decision: { optionId: 'B' },
    })
    expect(v1.links.notify?.title).toBe('Decision Sender')

    expectSuccess(await post(`${BASE}/${created.id}/ack`, { outcome: 'waited' }))
  })

  test('requires a campaign and a source, and a recommendation among the options', async () => {
    expectError(await post(BASE, decisionBody({ campaignId: undefined })), 400)
    expectError(await post(BASE, decisionBody({ source: undefined })), 400)
    expectError(await post(BASE, decisionBody({ recommendation: { optionId: 'Z' } })), 400)
  })

  test('level does not apply to a decision', async () => {
    const created = expectSuccess(await post<Message>(BASE, decisionBody()))
    expectError(await patch(`${BASE}/${created.id}`, { level: 'error' }), 400)
  })
})

describe('list', () => {
  test('filters by kind, expects, status, campaign and source issue', async () => {
    const sender = await createIssue('List Sender')
    const source = { projectId, issueId: sender }
    // Its own campaign: api-decision-events.test.ts writes 'camp-list' decisions to the same messages table
    const plain = await send({ source, campaignId: 'camp-messages-list' })
    const asked = await ask({ source, campaignId: 'camp-messages-list' })

    const bySender = expectSuccess(await get<Message[]>(`${BASE}?issueId=${sender}`))
    expect(bySender.map(m => m.id).sort()).toEqual([plain.id, asked.id].sort())

    const replies = expectSuccess(await get<Message[]>(`${BASE}?campaignId=camp-messages-list&expects=reply`))
    expect(replies.map(m => m.id)).toEqual([asked.id])

    const unread = expectSuccess(await get<Message[]>(`${BASE}?issueId=${sender}&status=unread,read`))
    expect(unread.map(m => m.id)).toEqual([plain.id])

    const notifications = expectSuccess(await get<Message[]>(`${BASE}?kind=notification&issueId=${sender}`))
    expect(notifications).toHaveLength(2)

    expectError(await get(`${BASE}?status=bogus`), 400)
  })

  test('the v1 decision API never shows a notification', async () => {
    const message = await ask({ campaignId: 'camp-v1' })
    expectError(await get(`/api/decisions/events/${message.id}`), 404)
    expectError(await post(`/api/decisions/events/${message.id}/close`, {}), 404)
    const v1 = expectSuccess(await get<DecisionEvent[]>('/api/decisions/events?campaignId=camp-v1'))
    expect(v1).toEqual([])
  })
})
