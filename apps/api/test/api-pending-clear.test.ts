/**
 * Pending-message recall + bulk clear semantics.
 *
 * Covers the user-reported bug: messages sent to a "done" issue accumulate
 * in the pending list with no way to clear them. The bulk DELETE is the
 * escape hatch; the frontend will also stop allowing new sends on done.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs, issues as issuesTable } from '@/db/schema'
import { upsertPendingMessage } from '@/db/pending-messages'
import { api, createTestProject, expectError, expectSuccess, get, post } from './helpers'
import './setup'

interface PendingMsg {
  messageId: string
  content: string
  metadata: { type: string } | null
}

let projectId: string
let issueId: string

beforeAll(async () => {
  projectId = await createTestProject('Pending Clear Project')
  // Create a 'done' issue directly so we don't trigger any execution side effects.
  const [created] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: 'done',
      issueNumber: 1,
      title: 'A done issue',
    })
    .returning({ id: issuesTable.id })
  issueId = created.id
})

describe('DELETE /api/projects/:projectId/issues/:id/pending — bulk clear', () => {
  test('clearing when no pending messages exist returns count=0 (idempotent)', async () => {
    const res = await api<{ count: number }>(
      'DELETE',
      `/api/projects/${projectId}/issues/${issueId}/pending`,
    )
    const data = expectSuccess(res)
    expect(data.count).toBe(0)
  })

  test('clearing removes all queued pending entries in one shot', async () => {
    // Seed 3 pending messages of mixed types
    await upsertPendingMessage(issueId, 'queued one', { type: 'pending' })
    await upsertPendingMessage(issueId, 'queued two', { type: 'pending' })
    await upsertPendingMessage(issueId, 'queued three (done)', { type: 'done' })

    const before = expectSuccess(await get<PendingMsg[]>(`/api/projects/${projectId}/issues/${issueId}/pending`))
    expect(before.length).toBe(3)

    const clear = expectSuccess(await api<{ count: number }>(
      'DELETE',
      `/api/projects/${projectId}/issues/${issueId}/pending`,
    ))
    expect(clear.count).toBe(3)

    const after = expectSuccess(await get<PendingMsg[]>(`/api/projects/${projectId}/issues/${issueId}/pending`))
    expect(after.length).toBe(0)

    // Verify DB-side: the rows are hard-deleted (not just hidden)
    const remaining = await db
      .select({ id: issueLogs.id })
      .from(issueLogs)
      .where(and(eq(issueLogs.issueId, issueId), eq(issueLogs.entryType, 'user-message')))
    // Only pending-shaped rows were deleted; non-pending user messages (none here) untouched.
    expect(remaining.length).toBe(0)
  })

  test('clearing a non-existent issue returns 404', async () => {
    const res = await api(
      'DELETE',
      `/api/projects/${projectId}/issues/does_not_exist/pending`,
    )
    expectError(res, 404)
  })
})

describe('DELETE /api/projects/:projectId/issues/:id/pending?messageId=... — single recall', () => {
  test('400 on malformed messageId', async () => {
    const res = await api(
      'DELETE',
      `/api/projects/${projectId}/issues/${issueId}/pending?messageId=not-a-ulid`,
    )
    expectError(res, 400)
  })

  test('404 when message does not exist', async () => {
    // Valid ULID format but not in DB
    const res = await api(
      'DELETE',
      `/api/projects/${projectId}/issues/${issueId}/pending?messageId=01ABCDEFGHJKMNPQRSTVWXYZAB`,
    )
    expectError(res, 404)
  })

  test('200 with content payload when message exists', async () => {
    const msgId = await upsertPendingMessage(issueId, 'single recall', { type: 'pending' })
    const res = await api<{ content: string }>(
      'DELETE',
      `/api/projects/${projectId}/issues/${issueId}/pending?messageId=${msgId}`,
    )
    const data = expectSuccess(res)
    expect(data.content).toBe('single recall')

    // Verify it's gone
    const after = expectSuccess(await get<PendingMsg[]>(`/api/projects/${projectId}/issues/${issueId}/pending`))
    expect(after.find(m => m.messageId === msgId)).toBeUndefined()
  })
})

describe('follow-up to a done issue stays observably queued (so the UI can warn)', () => {
  test('POSTing follow-up to done issue returns queued=true with type=done metadata', async () => {
    const res = await post<{ messageId: string, queued: boolean }>(
      `/api/projects/${projectId}/issues/${issueId}/follow-up`,
      { prompt: 'will sit forever unless cleared' },
    )
    const data = expectSuccess(res)
    expect(data.queued).toBe(true)
    expect(data.messageId).toBeTruthy()

    const pending = expectSuccess(await get<PendingMsg[]>(`/api/projects/${projectId}/issues/${issueId}/pending`))
    const hit = pending.find(m => m.messageId === data.messageId)
    expect(hit).toBeDefined()
    expect(hit!.metadata?.type).toBe('done')

    // Bulk-clear should sweep it up cleanly
    expectSuccess(await api<{ count: number }>(
      'DELETE',
      `/api/projects/${projectId}/issues/${issueId}/pending`,
    ))
    const after = expectSuccess(await get<PendingMsg[]>(`/api/projects/${projectId}/issues/${issueId}/pending`))
    expect(after.length).toBe(0)
  })
})
