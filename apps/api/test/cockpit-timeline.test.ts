import type { CockpitTimelineDelta } from '@bkd/shared'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  ack,
  appendOrReplace,
  bucketCounts,
  dismiss,
  listMessages,
  snooze,
  subscribeTimeline,
  supersedeForIssue,
} from '@/cockpit/timeline'
import { db } from '@/db'
import { cockpitTimelineMessages } from '@/db/schema'
import { createTestProject, expectSuccess, post } from './helpers'
import './setup'

let projectId: string
let issueId: string

beforeAll(async () => {
  projectId = await createTestProject('Timeline Test Project')
  const created = await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
    title: 'Target',
    statusId: 'todo',
  })
  issueId = expectSuccess(created).id
})

beforeEach(async () => {
  // Hard-clean any timeline rows between tests so partial unique
  // (signal_key WHERE status='open') doesn't leak across cases.
  await db.delete(cockpitTimelineMessages)
})

describe('cockpit timeline — appendOrReplace', () => {
  test('inserts a new open message and notifies subscribers', async () => {
    const received: CockpitTimelineDelta[] = []
    const unsub = subscribeTimeline(d => received.push(d))

    const msg = await appendOrReplace({
      kind: 'suggest_merge',
      issueId,
      projectId,
      body: 'first',
      signalKey: `merge:${issueId}`,
      actions: [],
    })

    expect(msg.status).toBe('open')
    expect(msg.kind).toBe('suggest_merge')
    expect(received).toHaveLength(1)
    expect(received[0]!.op).toBe('append')
    expect(received[0]!.message.id).toBe(msg.id)
    unsub()
  })

  test('replaces prior open message with same signalKey (supersedes)', async () => {
    const first = await appendOrReplace({
      kind: 'suggest_merge',
      issueId,
      projectId,
      body: 'first',
      signalKey: `merge:${issueId}`,
    })

    const second = await appendOrReplace({
      kind: 'suggest_merge',
      issueId,
      projectId,
      body: 'second',
      signalKey: `merge:${issueId}`,
    })

    expect(second.id).not.toBe(first.id)
    const all = await db
      .select({ id: cockpitTimelineMessages.id, status: cockpitTimelineMessages.status })
      .from(cockpitTimelineMessages)
      .where(eq(cockpitTimelineMessages.issueId, issueId))
    const firstAfter = all.find(r => r.id === first.id)
    expect(firstAfter?.status).toBe('superseded')
    expect(all.find(r => r.id === second.id)?.status).toBe('open')
  })
})

describe('cockpit timeline — state transitions', () => {
  test('ack moves status to acknowledged', async () => {
    const msg = await appendOrReplace({
      kind: 'suggest_merge',
      issueId,
      projectId,
      body: 'x',
      signalKey: `k1:${issueId}`,
    })
    const updated = await ack(msg.id)
    expect(updated?.status).toBe('acknowledged')
  })

  test('dismiss moves status to dismissed and hides from list', async () => {
    const msg = await appendOrReplace({
      kind: 'alert_off_track',
      issueId,
      projectId,
      body: 'x',
      signalKey: `k2:${issueId}`,
    })
    await dismiss(msg.id)
    const list = await listMessages()
    expect(list.find(m => m.id === msg.id)).toBeUndefined()
  })

  test('snooze hides until expiry, then surfaces again', async () => {
    const msg = await appendOrReplace({
      kind: 'suggest_merge',
      issueId,
      projectId,
      body: 'x',
      signalKey: `k3:${issueId}`,
    })
    // Snooze for 10 minutes — must be hidden right now.
    const future = Date.now() + 10 * 60 * 1000
    await snooze(msg.id, future)
    let list = await listMessages()
    expect(list.find(m => m.id === msg.id)).toBeUndefined()

    // Rewind snooze into the past — message must surface again.
    await db
      .update(cockpitTimelineMessages)
      .set({ snoozedUntil: Date.now() - 1000 })
      .where(eq(cockpitTimelineMessages.id, msg.id))
    list = await listMessages()
    expect(list.find(m => m.id === msg.id)).toBeDefined()
  })

  test('supersedeForIssue closes every open message tied to the issue', async () => {
    await appendOrReplace({
      kind: 'suggest_merge',
      issueId,
      projectId,
      body: 'a',
      signalKey: `merge:${issueId}`,
    })
    await appendOrReplace({
      kind: 'alert_off_track',
      issueId,
      projectId,
      body: 'b',
      signalKey: `offtrack:${issueId}`,
    })
    await supersedeForIssue(issueId)
    const list = await listMessages()
    expect(list.find(m => m.issueId === issueId && m.status === 'open')).toBeUndefined()
  })
})

describe('cockpit timeline — bucketCounts', () => {
  test('counts only open messages, grouped by kind', async () => {
    await appendOrReplace({
      kind: 'suggest_merge',
      issueId,
      projectId,
      body: 'a',
      signalKey: 'a',
    })
    const off = await appendOrReplace({
      kind: 'alert_off_track',
      issueId,
      projectId,
      body: 'b',
      signalKey: 'b',
    })
    const acked = await appendOrReplace({
      kind: 'suggest_merge',
      issueId,
      projectId,
      body: 'c',
      signalKey: 'c',
    })
    await ack(acked.id)
    await dismiss(off.id)

    const counts = await bucketCounts()
    expect(counts.suggest_merge).toBe(1)
    expect(counts.alert_off_track).toBe(0)
  })
})
