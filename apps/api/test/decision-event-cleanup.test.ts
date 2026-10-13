import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { runDecisionEventCleanup } from '@/cron/actions/builtins/decision-event-cleanup'
import { db } from '@/db'
import { decisionEvents } from '@/db/schema'
import { appEvents } from '@/events'
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

/** Create an event in `status`, last touched `ageHours` ago. */
async function seed(status: string, ageHours: number): Promise<string> {
  const id = await createEvent()
  await db
    .update(decisionEvents)
    .set({ status, updatedAt: new Date(Date.now() - ageHours * HOUR) })
    .where(eq(decisionEvents.id, id))
  return id
}

async function isDeleted(id: string): Promise<boolean> {
  const [row] = await db
    .select({ isDeleted: decisionEvents.isDeleted })
    .from(decisionEvents)
    .where(eq(decisionEvents.id, id))
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

describe('decision event cleanup', () => {
  test('removes every non-open event untouched for a day', async () => {
    const ids = await Promise.all(
      ['decided', 'applied', 'withdrawn', 'closed'].map(status => seed(status, 25)),
    )

    await runDecisionEventCleanup()

    for (const id of ids) {
      expect(await isDeleted(id)).toBe(true)
      expect((await get(`${BASE}/${id}`)).status).toBe(404)
    }
  })

  test('keeps open events however old', async () => {
    const id = await seed('open', 24 * 30)

    await runDecisionEventCleanup()

    expect(await isDeleted(id)).toBe(false)
  })

  test('keeps events touched within the last day', async () => {
    const id = await seed('decided', 23)

    await runDecisionEventCleanup()

    expect(await isDeleted(id)).toBe(false)
  })

  test('signals each removed event', async () => {
    const id = await seed('closed', 25)
    const seen: string[] = []
    const unsubscribe = appEvents.on('decision-event-updated', (data) => {
      seen.push(data.id)
    })

    await runDecisionEventCleanup()
    unsubscribe()

    expect(seen).toContain(id)
  })
})
