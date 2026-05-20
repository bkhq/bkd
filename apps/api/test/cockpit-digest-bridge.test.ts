import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { startCockpitDigestBridge } from '@/cockpit/digest-bridge'
import { listMessages } from '@/cockpit/timeline'
import { db } from '@/db'
import { cockpitTimelineMessages, issueLogs, issues as issuesTable } from '@/db/schema'
import { appEvents } from '@/events'
import { createTestProject, expectSuccess, post, waitFor } from './helpers'
import './setup'

let projectId: string
let stopBridge: () => void

async function makeReviewIssue(withAssistantLog = true): Promise<string> {
  const created = expectSuccess(await post<{ id: string }>(
    `/api/projects/${projectId}/issues`,
    { title: `db-${Date.now()}-${Math.random()}`, statusId: 'todo' },
  ))
  await db
    .update(issuesTable)
    .set({ statusId: 'review', statusUpdatedAt: new Date() })
    .where(eq(issuesTable.id, created.id))
  if (withAssistantLog) {
    await db.insert(issueLogs).values({
      issueId: created.id,
      turnIndex: 0,
      entryIndex: 0,
      entryType: 'assistant-message',
      content: 'done',
      visible: 1,
    })
  }
  return created.id
}

async function openMessagesFor(issueId: string) {
  const all = await listMessages({ limit: 200 })
  return all.filter(m => m.issueId === issueId && m.status === 'open')
}

beforeAll(async () => {
  projectId = await createTestProject('Digest Bridge Test Project')
  // Start the bridge AFTER project setup so cold-start has a clean slate.
  stopBridge = startCockpitDigestBridge()
})

afterAll(() => {
  stopBridge?.()
})

beforeEach(async () => {
  await db.delete(cockpitTimelineMessages)
})

describe('digest-bridge — issue-updated wiring', () => {
  test('engine-driven review transition posts a suggest_merge', async () => {
    const issueId = await makeReviewIssue()
    appEvents.emit('issue-updated', {
      issueId,
      changes: { statusId: 'review' },
      source: 'engine',
    })
    await waitFor(async () => (await openMessagesFor(issueId)).length > 0, 3000)
    const msgs = await openMessagesFor(issueId)
    expect(msgs[0]!.kind).toBe('suggest_merge')
  })

  test('user-driven review transition is ignored (no row)', async () => {
    const issueId = await makeReviewIssue()
    appEvents.emit('issue-updated', {
      issueId,
      changes: { statusId: 'review' },
      source: 'user',
    })
    // Give the async classify a chance to (not) run.
    await Bun.sleep(300)
    expect(await openMessagesFor(issueId)).toHaveLength(0)
  })

  test('transition out of review supersedes an open row', async () => {
    const issueId = await makeReviewIssue()
    appEvents.emit('issue-updated', {
      issueId,
      changes: { statusId: 'review' },
      source: 'engine',
    })
    await waitFor(async () => (await openMessagesFor(issueId)).length > 0, 3000)

    // Engine moves it back to working (e.g. restart) → row must clear.
    appEvents.emit('issue-updated', {
      issueId,
      changes: { statusId: 'working' },
      source: 'engine',
    })
    await waitFor(async () => (await openMessagesFor(issueId)).length === 0, 3000)
    expect(await openMessagesFor(issueId)).toHaveLength(0)
  })
})

describe('digest-bridge — done wiring', () => {
  test('three failed runs surface an alert_repeat_fail', async () => {
    const issueId = await makeReviewIssue(false)
    for (let i = 0; i < 3; i++) {
      appEvents.emit('done', {
        issueId,
        executionId: `exec-${i}`,
        finalStatus: 'failed',
      })
      await Bun.sleep(120)
    }
    await waitFor(async () => {
      const msgs = await openMessagesFor(issueId)
      return msgs.some(m => m.kind === 'alert_repeat_fail')
    }, 3000)
    const msgs = await openMessagesFor(issueId)
    expect(msgs.some(m => m.kind === 'alert_repeat_fail')).toBe(true)
  })

  test('a single failure does not trip the alert', async () => {
    const issueId = await makeReviewIssue(false)
    appEvents.emit('done', { issueId, executionId: 'x', finalStatus: 'failed' })
    await Bun.sleep(300)
    const msgs = await openMessagesFor(issueId)
    expect(msgs.some(m => m.kind === 'alert_repeat_fail')).toBe(false)
  })
})

describe('digest-bridge — changes-summary wiring', () => {
  test('wide diff on a review issue posts alert_off_track', async () => {
    const issueId = await makeReviewIssue()
    appEvents.emit('changes-summary', {
      issueId,
      fileCount: 25,
      additions: 400,
      deletions: 30,
    })
    await waitFor(async () => {
      const msgs = await openMessagesFor(issueId)
      return msgs.some(m => m.kind === 'alert_off_track')
    }, 3000)
    const msgs = await openMessagesFor(issueId)
    expect(msgs.some(m => m.kind === 'alert_off_track')).toBe(true)
  })
})
