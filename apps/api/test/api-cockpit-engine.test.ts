/**
 * POST /api/cockpit/engine — change the cockpit assistant's engine.
 * Verifies engineType is persisted on the singleton issue AND the session
 * is invalidated so the next /ask is treated as a first turn (engine swap
 * requires a fresh session because session id is engine-specific).
 */
import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { api, expectError, expectSuccess, get } from './helpers'
import './setup'

interface SingletonResponse {
  project: { id: string }
  issueId: string
}

describe('POST /api/cockpit/engine', () => {
  test('400 when engineType missing', async () => {
    const res = await api('POST', '/api/cockpit/engine', {})
    expectError(res, 400)
  })

  test('updates engineType + clears session on the singleton', async () => {
    // Ensure the singleton exists + seed a fake externalSessionId so we can
    // verify it gets cleared.
    const singleton = expectSuccess(
      await get<SingletonResponse>('/api/cockpit/_singleton'),
    )
    await db
      .update(issuesTable)
      .set({ externalSessionId: 'pre-existing', sessionStatus: 'completed' })
      .where(eq(issuesTable.id, singleton.issueId))

    const res = await api<{ engineType: string }>('POST', '/api/cockpit/engine', {
      engineType: 'claude-code',
    })
    const data = expectSuccess(res)
    expect(data.engineType).toBe('claude-code')

    const [row] = await db
      .select({
        engineType: issuesTable.engineType,
        externalSessionId: issuesTable.externalSessionId,
        sessionStatus: issuesTable.sessionStatus,
      })
      .from(issuesTable)
      .where(eq(issuesTable.id, singleton.issueId))
    expect(row?.engineType).toBe('claude-code')
    expect(row?.externalSessionId).toBeNull()
    expect(row?.sessionStatus).toBeNull()
  })

  test('engine change persists across calls (subsequent ask sees new engine)', async () => {
    expectSuccess(
      await api<{ engineType: string }>('POST', '/api/cockpit/engine', {
        engineType: 'codex',
      }),
    )
    const singleton = expectSuccess(
      await get<SingletonResponse>('/api/cockpit/_singleton'),
    )
    const [row] = await db
      .select({ engineType: issuesTable.engineType })
      .from(issuesTable)
      .where(eq(issuesTable.id, singleton.issueId))
    expect(row?.engineType).toBe('codex')
  })
})
