import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { runMessageCleanup } from '@/cron/actions/builtins/message-cleanup'
import { db } from '@/db'
import { messages } from '@/db/schema'
import { appEvents } from '@/events'
import { resetSendLimits } from '@/messages/service'
import { createTestProject, expectSuccess, get, post } from './helpers'
import './setup'

const BASE = '/api/decisions/events'
const HOUR = 60 * 60 * 1000

let projectId: string
let issueId: string

async function createEvent(): Promise<string> {
  const event = expectSuccess(
    await post<{ id: string }>(BASE, {
      campaignId: 'camp-cleanup',
      question: 'Ship it?',
      options: [{ id: 'A', label: 'Yes', impact: 'ships' }],
      notify: { type: 'bkd-follow-up', projectId, issueId },
    }),
  )
  return event.id
}

async function createNotification(expects: 'none' | 'reply'): Promise<string> {
  resetSendLimits()
  const message = expectSuccess(
    await post<{ id: string }>('/api/messages/items', {
      kind: 'notification',
      expects,
      title: 'Deploy finished',
      source: { projectId, issueId },
    }),
  )
  return message.id
}

async function age(id: string, status: string, ageHours: number): Promise<void> {
  await db
    .update(messages)
    .set({ status, updatedAt: new Date(Date.now() - ageHours * HOUR) })
    .where(eq(messages.id, id))
}

/** Create an event in `status`, last touched `ageHours` ago. */
async function seed(status: string, ageHours: number): Promise<string> {
  const id = await createEvent()
  await db
    .update(messages)
    .set({ status, updatedAt: new Date(Date.now() - ageHours * HOUR) })
    .where(eq(messages.id, id))
  return id
}

async function isDeleted(id: string): Promise<boolean> {
  const [row] = await db
    .select({ isDeleted: messages.isDeleted })
    .from(messages)
    .where(eq(messages.id, id))
  return row!.isDeleted === 1
}

beforeAll(async () => {
  projectId = await createTestProject('Decision Cleanup Test')
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'Coordinator',
      statusId: 'todo',
      engineType: 'codex',
      model: 'auto',
    }),
  )
  issueId = issue.id
})

describe('message cleanup', () => {
  test('removes every terminal event untouched for a day', async () => {
    const ids = await Promise.all(
      ['applied', 'withdrawn', 'closed'].map(status => seed(status, 25)),
    )

    await runMessageCleanup()

    for (const id of ids) {
      expect(await isDeleted(id)).toBe(true)
      expect((await get(`${BASE}/${id}`)).status).toBe(404)
    }
  })

  test('keeps open events however old', async () => {
    const id = await seed('open', 24 * 30)

    await runMessageCleanup()

    expect(await isDeleted(id)).toBe(false)
  })

  test('keeps a decided event however old, so a missed wake does not lose the answer', async () => {
    const id = await seed('decided', 24 * 30)

    await runMessageCleanup()

    expect(await isDeleted(id)).toBe(false)
    expect((await get(`${BASE}/${id}`)).status).toBe(200)
  })

  test('keeps events touched within the last day', async () => {
    const id = await seed('applied', 23)

    await runMessageCleanup()

    expect(await isDeleted(id)).toBe(false)
  })

  test('signals each removed event', async () => {
    const id = await seed('closed', 25)
    const seen: string[] = []
    const unsubscribe = appEvents.on('message-updated', (data) => {
      seen.push(data.id)
    })

    await runMessageCleanup()
    unsubscribe()

    expect(seen).toContain(id)
  })

  test('removes settled reply notifications after a day, keeps open and replied ones', async () => {
    const settled = await createNotification('reply')
    await age(settled, 'applied', 25)
    const open = await createNotification('reply')
    await age(open, 'open', 24 * 30)
    const replied = await createNotification('reply')
    await age(replied, 'replied', 24 * 30)

    await runMessageCleanup()

    expect(await isDeleted(settled)).toBe(true)
    expect(await isDeleted(open)).toBe(false)
    expect(await isDeleted(replied)).toBe(false)
  })

  test('removes read notifications after a week, keeps unread ones', async () => {
    const oldRead = await createNotification('none')
    await age(oldRead, 'read', 24 * 8)
    const recentRead = await createNotification('none')
    await age(recentRead, 'read', 24 * 6)
    const oldUnread = await createNotification('none')
    await age(oldUnread, 'unread', 24 * 30)

    await runMessageCleanup()

    expect(await isDeleted(oldRead)).toBe(true)
    expect(await isDeleted(recentRead)).toBe(false)
    expect(await isDeleted(oldUnread)).toBe(false)
  })
})
