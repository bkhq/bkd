import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { expectSuccess, get, post } from './helpers'
import './setup'

interface SingletonResponse {
  project: { id: string, alias: string }
  issueId: string
  isFresh: boolean
}

describe('POST /api/cockpit/reset', () => {
  test('soft-deletes the assistant issue and forces a fresh one next time', async () => {
    const before = expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    const oldId = before.issueId

    const reset = await post<{ deletedIssueId: string }>('/api/cockpit/reset', {})
    const resetData = expectSuccess(reset)
    expect(resetData.deletedIssueId).toBe(oldId)

    // The old issue must be soft-deleted
    const [row] = await db
      .select({ isDeleted: issuesTable.isDeleted })
      .from(issuesTable)
      .where(eq(issuesTable.id, oldId))
    expect(row?.isDeleted).toBe(1)

    // The next singleton fetch must return a fresh issue
    const after = expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    expect(after.issueId).not.toBe(oldId)
    expect(after.isFresh).toBe(true)
  })

  test('reset is a no-op when no assistant exists yet', async () => {
    // Nuke any prior pointer by calling reset first to set baseline, then again
    expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    expectSuccess(await post<unknown>('/api/cockpit/reset', {}))
    // Second reset should still respond OK
    const second = await post('/api/cockpit/reset', {})
    expect(second.status).toBe(200)
  })
})
