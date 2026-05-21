import type { CockpitTimelineMessage, CockpitTimelineMessageKind } from '@bkd/shared'
import { describe, expect, it } from 'vitest'
import { patchSnapshot } from '@/hooks/use-cockpit-timeline'

function mkMsg(over: Partial<CockpitTimelineMessage> = {}): CockpitTimelineMessage {
  return {
    id: 'm1',
    kind: 'suggest_merge',
    projectId: 'p1',
    projectAlias: 'demo',
    issueId: 'i1',
    issueNumber: 1,
    issueTitle: 't',
    body: 'b',
    actions: [],
    signalKey: 'merge:i1',
    status: 'open',
    snoozedUntil: null,
    recommendation: null,
    enrichedAt: null,
    enrichmentStatus: 'template',
    enrichmentError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }
}

describe('patchSnapshot', () => {
  it('seeds an empty snapshot when prev is undefined', () => {
    const snap = patchSnapshot(undefined, mkMsg())
    expect(snap.messages).toHaveLength(1)
    expect(snap.counts.suggest_merge).toBe(1)
  })

  it('prepends a new message (newest first)', () => {
    const first = patchSnapshot(undefined, mkMsg({ id: 'a', signalKey: 'merge:a' }))
    const second = patchSnapshot(first, mkMsg({ id: 'b', signalKey: 'merge:b' }))
    expect(second.messages.map(m => m.id)).toEqual(['b', 'a'])
  })

  it('upserts in place when the id already exists', () => {
    const first = patchSnapshot(undefined, mkMsg({ id: 'a', body: 'old' }))
    const second = patchSnapshot(first, mkMsg({ id: 'a', body: 'new' }))
    expect(second.messages).toHaveLength(1)
    expect(second.messages[0]!.body).toBe('new')
  })

  it('recomputes counts — only open messages count, grouped by kind', () => {
    let snap = patchSnapshot(undefined, mkMsg({ id: 'a', kind: 'suggest_merge', signalKey: 'k:a' }))
    snap = patchSnapshot(snap, mkMsg({ id: 'b', kind: 'alert_off_track', signalKey: 'k:b' }))
    snap = patchSnapshot(snap, mkMsg({ id: 'c', kind: 'alert_off_track', signalKey: 'k:c' }))
    // Acknowledge one off-track — must drop out of the count.
    snap = patchSnapshot(snap, mkMsg({ id: 'c', kind: 'alert_off_track', signalKey: 'k:c', status: 'acknowledged' }))
    expect(snap.counts.suggest_merge).toBe(1)
    expect(snap.counts.alert_off_track).toBe(1)
  })

  it('drops a message from counts when it transitions to dismissed', () => {
    const open = patchSnapshot(undefined, mkMsg({ id: 'a' }))
    expect(open.counts.suggest_merge).toBe(1)
    const dismissed = patchSnapshot(open, mkMsg({ id: 'a', status: 'dismissed' }))
    expect(dismissed.counts.suggest_merge).toBe(0)
  })

  it('caps the in-memory window at 200 messages', () => {
    let snap = patchSnapshot(undefined, mkMsg({ id: 'seed', signalKey: 'k:seed' }))
    for (let i = 0; i < 250; i++) {
      snap = patchSnapshot(snap, mkMsg({ id: `n${i}`, signalKey: `k:n${i}` }))
    }
    expect(snap.messages).toHaveLength(200)
    // Newest (n249) retained, oldest (seed) evicted.
    expect(snap.messages[0]!.id).toBe('n249')
    expect(snap.messages.some(m => m.id === 'seed')).toBe(false)
  })

  it('handles every kind without throwing', () => {
    const kinds: CockpitTimelineMessageKind[] = [
      'suggest_merge',
      'alert_off_track',
      'suggest_reply',
      'alert_repeat_fail',
      'alert_stale_working',
      'ack',
      'info',
    ]
    let snap = patchSnapshot(undefined, mkMsg({ id: 'x0', kind: kinds[0]!, signalKey: 'k:x0' }))
    kinds.forEach((k, i) => {
      snap = patchSnapshot(snap, mkMsg({ id: `x${i}`, kind: k, signalKey: `k:x${i}` }))
    })
    const total = Object.values(snap.counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(kinds.length)
  })
})
