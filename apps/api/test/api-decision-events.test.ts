import { beforeAll, describe, expect, test } from 'bun:test'
import { createTestProject, del, expectError, expectSuccess, get, patch, post } from './helpers'
import './setup'

interface DecisionEvent {
  id: string
  status: string
  campaignId: string
  ref: string | null
  question: string
  context: string
  options: { id: string, label: string, impact: string }[]
  recommendation: { optionId: string, reason: string } | null
  blocks: string | null
  continues: string | null
  notify: { type: string, bkdUrl?: string, projectId: string, issueId: string }
  decision: { optionId: string | null, instruction: string, decidedBy: string, decidedAt: string } | null
  outcome: string | null
  withdrawReason: string | null
  closeReason: string | null
  notifiedAt: string | null
  links: {
    projectName: string | null
    ref: { issueId: string, projectId: string, issueNumber: number, title: string } | null
    notify: { issueId: string, projectId: string, issueNumber: number, title: string } | null
  }
}

interface PendingMessage {
  messageId: string
  content: string
}

const BASE = '/api/decisions/events'

let projectId: string
let coordinatorId: string
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

function body(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: 'camp-1',
    ref: subjectId,
    question: 'Merge the storage rewrite now?',
    context: 'apps/api/src/db/index.ts:10-40',
    options: [
      { id: 'A', label: 'Merge now', impact: 'unblocks lane 2' },
      { id: 'B', label: 'Wait for review', impact: 'one more day' },
    ],
    recommendation: { optionId: 'A', reason: 'tests are green' },
    blocks: 'lane 2',
    continues: 'lane 3',
    notify: { type: 'bkd-follow-up', bkdUrl: 'http://bkd.localhost', projectId, issueId: coordinatorId },
    ...overrides,
  }
}

async function createEvent(overrides: Record<string, unknown> = {}): Promise<DecisionEvent> {
  return expectSuccess(await post<DecisionEvent>(BASE, body(overrides)))
}

async function pendingOf(issueId: string): Promise<string[]> {
  const rows = expectSuccess(
    await get<PendingMessage[]>(`/api/projects/${projectId}/issues/${issueId}/pending`),
  )
  return rows.map(r => r.content)
}

beforeAll(async () => {
  projectId = await createTestProject('Decision Events Test')
  coordinatorId = await createIssue('Coordinator')
  subjectId = await createIssue('Subject')
})

describe('capability probe', () => {
  test('reports decision-event support', async () => {
    const data = expectSuccess(
      await get<{ supported: boolean, contractVersion: number }>('/api/decisions'),
    )
    expect(data).toEqual({ supported: true, contractVersion: 1 })
  })
})

describe('create', () => {
  test('stores the card and returns it open', async () => {
    const res = await post<DecisionEvent>(BASE, body())
    expect(res.status).toBe(201)
    const event = expectSuccess(res)
    expect(event.status).toBe('open')
    expect(event.campaignId).toBe('camp-1')
    expect(event.options).toHaveLength(2)
    expect(event.recommendation).toEqual({ optionId: 'A', reason: 'tests are green' })
    expect(event.notify.issueId).toBe(coordinatorId)
    expect(event.decision).toBeNull()
    expect(event.notifiedAt).toBeNull()
    expect(event.links.projectName).toBe('Decision Events Test')
    expect(event.links.ref?.title).toBe('Subject')
    expect(event.links.notify?.title).toBe('Coordinator')
  })

  test('rejects a notify issue that is not in the notify project', async () => {
    const other = await createTestProject('Decision Events Other')
    const res = await post(BASE, body({
      notify: { type: 'bkd-follow-up', projectId: other, issueId: coordinatorId },
    }))
    expectError(res, 400)
  })

  test('rejects duplicate option ids and an unknown recommended option', async () => {
    expectError(await post(BASE, body({
      options: [{ id: 'A', label: 'one' }, { id: 'A', label: 'two' }],
      recommendation: undefined,
    })), 400)
    expectError(await post(BASE, body({
      recommendation: { optionId: 'Z', reason: 'none' },
    })), 400)
  })

  test('rejects a missing question', async () => {
    expectError(await post(BASE, body({ question: '' })), 400)
  })
})

describe('get and list', () => {
  test('returns one event and 404 for an unknown id', async () => {
    const event = await createEvent()
    const found = expectSuccess(await get<DecisionEvent>(`${BASE}/${event.id}`))
    expect(found.id).toBe(event.id)
    expectError(await get(`${BASE}/nope0000`), 404)
  })

  test('filters by campaign and by status', async () => {
    const a = await createEvent({ campaignId: 'camp-list' })
    const b = await createEvent({ campaignId: 'camp-list' })
    expectSuccess(await post(`${BASE}/${b.id}/withdraw`, { reason: 'moot' }))

    const all = expectSuccess(await get<DecisionEvent[]>(`${BASE}?campaignId=camp-list`))
    expect(all.map(e => e.id).sort()).toEqual([a.id, b.id].sort())

    const open = expectSuccess(await get<DecisionEvent[]>(`${BASE}?campaignId=camp-list&status=open`))
    expect(open.map(e => e.id)).toEqual([a.id])

    const both = expectSuccess(
      await get<DecisionEvent[]>(`${BASE}?campaignId=camp-list&status=open,withdrawn`),
    )
    expect(both).toHaveLength(2)

    expectError(await get(`${BASE}?status=bogus`), 400)
  })
})

describe('update facts', () => {
  test('patches an open event', async () => {
    const event = await createEvent()
    const updated = expectSuccess(
      await patch<DecisionEvent>(`${BASE}/${event.id}`, { context: 'new facts', blocks: 'lane 4' }),
    )
    expect(updated.context).toBe('new facts')
    expect(updated.blocks).toBe('lane 4')
    expect(updated.question).toBe(event.question)
  })

  test('rejects options that orphan the recommendation', async () => {
    const event = await createEvent()
    expectError(
      await patch(`${BASE}/${event.id}`, { options: [{ id: 'C', label: 'other' }] }),
      400,
    )
  })

  test('refuses to patch once decided', async () => {
    const event = await createEvent()
    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'A' }))
    expectError(await patch(`${BASE}/${event.id}`, { context: 'late' }), 409)
  })
})

describe('decision', () => {
  test('records an option and wakes the notify issue', async () => {
    const coordinator = await createIssue('Coordinator decide')
    const event = await createEvent({
      campaignId: 'camp-wake',
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinator },
    })

    const decided = expectSuccess(
      await post<DecisionEvent>(`${BASE}/${event.id}/decision`, { optionId: 'B' }),
    )
    expect(decided.status).toBe('decided')
    expect(decided.decision?.optionId).toBe('B')
    expect(decided.decision?.instruction).toBe('')
    expect(decided.decision?.decidedBy).toBe('user')
    expect(decided.decision?.decidedAt).toBeTruthy()
    expect(decided.notifiedAt).toBeTruthy()
    // Whole seconds, like every other timestamp, so notifiedAt never sorts before decidedAt
    expect(decided.decision?.decidedAt).toMatch(/\.000Z$/)
    expect(new Date(decided.notifiedAt!).getTime()).toBeGreaterThanOrEqual(new Date(decided.decision!.decidedAt).getTime())

    expect(await pendingOf(coordinator)).toEqual([
      `[event-decision eventId=${event.id} campaignId=camp-wake]`,
    ])
  })

  test('accepts a free-form instruction without an option', async () => {
    const event = await createEvent()
    const decided = expectSuccess(
      await post<DecisionEvent>(`${BASE}/${event.id}/decision`, {
        instruction: 'Split it into two PRs',
        decidedBy: 'roy',
      }),
    )
    expect(decided.decision).toMatchObject({
      optionId: null,
      instruction: 'Split it into two PRs',
      decidedBy: 'roy',
    })
  })

  test('rejects an empty decision and an unknown option', async () => {
    const event = await createEvent()
    expectError(await post(`${BASE}/${event.id}/decision`, {}), 400)
    expectError(await post(`${BASE}/${event.id}/decision`, { optionId: 'Z' }), 400)
    const still = expectSuccess(await get<DecisionEvent>(`${BASE}/${event.id}`))
    expect(still.status).toBe('open')
  })

  test('cannot be decided twice', async () => {
    const event = await createEvent()
    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'A' }))
    expectError(await post(`${BASE}/${event.id}/decision`, { optionId: 'B' }), 409)
  })

  test('stays decided when the notify issue is gone, and can be resent', async () => {
    const coordinator = await createIssue('Coordinator gone')
    const event = await createEvent({
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinator },
    })
    expectSuccess(await del(`/api/projects/${projectId}/issues/${coordinator}`))

    const decided = expectSuccess(
      await post<DecisionEvent>(`${BASE}/${event.id}/decision`, { optionId: 'A' }),
    )
    expect(decided.status).toBe('decided')
    expect(decided.notifiedAt).toBeNull()

    expectError(await post(`${BASE}/${event.id}/notify`, {}), 502)
  })

  test('resend delivers the wake signal again while decided', async () => {
    const coordinator = await createIssue('Coordinator resend')
    const event = await createEvent({
      campaignId: 'camp-resend',
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinator },
    })
    expectError(await post(`${BASE}/${event.id}/notify`, {}), 409)

    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'A' }))
    const resent = expectSuccess(await post<DecisionEvent>(`${BASE}/${event.id}/notify`, {}))
    expect(resent.notifiedAt).toBeTruthy()
  })
})

describe('ack', () => {
  test('moves a decided event to applied with its outcome', async () => {
    const event = await createEvent()
    expectError(await post(`${BASE}/${event.id}/ack`, { outcome: 'too early' }), 409)

    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'A' }))
    const applied = expectSuccess(
      await post<DecisionEvent>(`${BASE}/${event.id}/ack`, { outcome: 'merged into main' }),
    )
    expect(applied.status).toBe('applied')
    expect(applied.outcome).toBe('merged into main')

    expectError(await post(`${BASE}/${event.id}/ack`, { outcome: 'again' }), 409)
  })

  test('requires an outcome', async () => {
    const event = await createEvent()
    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'A' }))
    expectError(await post(`${BASE}/${event.id}/ack`, {}), 400)
  })
})

describe('withdraw', () => {
  test('withdraws an open event with its reason', async () => {
    const event = await createEvent()
    const withdrawn = expectSuccess(
      await post<DecisionEvent>(`${BASE}/${event.id}/withdraw`, { reason: 'lane dropped' }),
    )
    expect(withdrawn.status).toBe('withdrawn')
    expect(withdrawn.withdrawReason).toBe('lane dropped')
  })

  test('refuses once decided', async () => {
    const event = await createEvent()
    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'A' }))
    expectError(await post(`${BASE}/${event.id}/withdraw`, { reason: 'late' }), 409)
  })
})

describe('close', () => {
  test('closes an open event without waking the notify issue', async () => {
    const coordinator = await createIssue('Coordinator close')
    const event = await createEvent({
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinator },
    })
    const closed = expectSuccess(
      await post<DecisionEvent>(`${BASE}/${event.id}/close`, { reason: 'not needed' }),
    )
    expect(closed.status).toBe('closed')
    expect(closed.closeReason).toBe('not needed')
    expect(closed.decision).toBeNull()
    expect(await pendingOf(coordinator)).toEqual([])
  })

  test('closes a decided event and keeps its decision', async () => {
    const coordinator = await createIssue('Coordinator close decided')
    const event = await createEvent({
      notify: { type: 'bkd-follow-up', projectId, issueId: coordinator },
    })
    expectSuccess(await post(`${BASE}/${event.id}/decision`, { optionId: 'A' }))
    const closed = expectSuccess(await post<DecisionEvent>(`${BASE}/${event.id}/close`, {}))
    expect(closed.status).toBe('closed')
    expect(closed.closeReason).toBeNull()
    expect(closed.decision?.optionId).toBe('A')
    expect(await pendingOf(coordinator)).toHaveLength(1)
  })

  test('is terminal, and terminal events cannot be closed', async () => {
    const closed = await createEvent()
    expectSuccess(await post(`${BASE}/${closed.id}/close`, {}))
    expectError(await post(`${BASE}/${closed.id}/close`, {}), 409)
    expectError(await post(`${BASE}/${closed.id}/decision`, { optionId: 'A' }), 409)

    const withdrawn = await createEvent()
    expectSuccess(await post(`${BASE}/${withdrawn.id}/withdraw`, { reason: 'moot' }))
    expectError(await post(`${BASE}/${withdrawn.id}/close`, {}), 409)

    const applied = await createEvent()
    expectSuccess(await post(`${BASE}/${applied.id}/decision`, { optionId: 'A' }))
    expectSuccess(await post(`${BASE}/${applied.id}/ack`, { outcome: 'done' }))
    expectError(await post(`${BASE}/${applied.id}/close`, {}), 409)
  })
})
