/**
 * Direct unit tests for the in-memory proposalStore (no HTTP layer).
 * Covers TTL boundary, state-machine illegal transitions, and idempotency.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { proposalStore } from '@/cockpit/proposals'
import './setup'

describe('proposalStore: state machine', () => {
  beforeEach(() => proposalStore.clear())

  test('markApproved on a non-pending proposal returns undefined', () => {
    const p = proposalStore.propose('cancel_issue', { issueId: 'x' }, 's')
    expect(proposalStore.markApproved(p.id, null)?.status).toBe('approved')
    expect(proposalStore.markApproved(p.id, null)).toBeUndefined()
  })

  test('markRejected on a non-pending proposal returns undefined', () => {
    const p = proposalStore.propose('cancel_issue', { issueId: 'x' }, 's')
    expect(proposalStore.markRejected(p.id)?.status).toBe('rejected')
    expect(proposalStore.markRejected(p.id)).toBeUndefined()
  })

  test('markFailed only acts on pending', () => {
    const p = proposalStore.propose('cancel_issue', { issueId: 'x' }, 's')
    proposalStore.markApproved(p.id, null)
    expect(proposalStore.markFailed(p.id, 'oops')).toBeUndefined()
  })

  test('markApproved attaches the dispatch result', () => {
    const p = proposalStore.propose('create_issue', { projectId: 'p', title: 't' }, 's')
    const updated = proposalStore.markApproved(p.id, { id: 'new-issue' })
    expect(updated?.result).toEqual({ id: 'new-issue' })
  })

  test('markFailed attaches the error', () => {
    const p = proposalStore.propose('cancel_issue', { issueId: 'x' }, 's')
    const updated = proposalStore.markFailed(p.id, 'boom')
    expect(updated?.status).toBe('failed')
    expect(updated?.error).toBe('boom')
  })
})

describe('proposalStore: TTL boundary', () => {
  beforeEach(() => proposalStore.clear())

  test('listPending evicts expired proposals (TTL = 30 min)', () => {
    const p1 = proposalStore.propose('cancel_issue', { issueId: 'fresh' }, 'fresh')
    const p2 = proposalStore.propose('cancel_issue', { issueId: 'stale' }, 'stale')
    // Backdate p2 past TTL
    const internal = proposalStore as unknown as { map: Map<string, { createdAt: number }> }
    const rec = internal.map.get(p2.id)!
    rec.createdAt = Date.now() - 31 * 60 * 1000

    const pending = proposalStore.listPending()
    expect(pending.find(x => x.id === p1.id)).toBeDefined()
    expect(pending.find(x => x.id === p2.id)).toBeUndefined()
  })

  test('expired proposals cannot be approved', () => {
    const p = proposalStore.propose('cancel_issue', { issueId: 'x' }, 'x')
    const internal = proposalStore as unknown as { map: Map<string, { createdAt: number }> }
    internal.map.get(p.id)!.createdAt = Date.now() - 60 * 60 * 1000
    expect(proposalStore.markApproved(p.id, null)).toBeUndefined()
  })

  test('list() returns ALL records (incl. non-pending) sorted DESC', async () => {
    const p1 = proposalStore.propose('cancel_issue', { issueId: '1' }, '1')
    await Bun.sleep(2)
    const p2 = proposalStore.propose('cancel_issue', { issueId: '2' }, '2')
    proposalStore.markRejected(p1.id)
    const all = proposalStore.list()
    expect(all[0].id).toBe(p2.id)
    expect(all[1].id).toBe(p1.id)
    expect(all.find(x => x.id === p1.id)?.status).toBe('rejected')
  })
})

describe('proposalStore: idempotent propose', () => {
  beforeEach(() => proposalStore.clear())

  test('two proposals with same type+params are distinct ids', () => {
    const a = proposalStore.propose('cancel_issue', { issueId: 'x' }, 's')
    const b = proposalStore.propose('cancel_issue', { issueId: 'x' }, 's')
    expect(a.id).not.toBe(b.id)
    expect(proposalStore.listPending().length).toBe(2)
  })
})
