/**
 * POST /api/cockpit/ask — first-turn + follow-up smoke.
 *
 * We don't have a working claude-code-sdk binary in tests, so executeIssue
 * will fail at the executor layer. What we CAN verify:
 *  - the route returns a JSON envelope (success or error, no 500-crash)
 *  - it bumps the assistant issue's sessionStatus / engineType / prompt
 *    BEFORE calling executor (so /ask is observably wired)
 *  - it accepts the contract (prompt required, model regex-validated)
 */
import { describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { expectError, expectSuccess, get, post } from './helpers'
import './setup'

interface AskResponse {
  issueId: string
  executionId: string
  firstTurn: boolean
}

interface SingletonResponse {
  project: { id: string, alias: string }
  issueId: string
  isFresh: boolean
}

describe('POST /api/cockpit/ask', () => {
  test('rejects missing prompt with 400', async () => {
    const res = await post('/api/cockpit/ask', {})
    expectError(res, 400)
  })

  test('rejects empty prompt with 400', async () => {
    const res = await post('/api/cockpit/ask', { prompt: '' })
    expectError(res, 400)
  })

  test('rejects invalid model format with 400', async () => {
    const res = await post('/api/cockpit/ask', { prompt: 'hi', model: 'bad model with spaces!' })
    expectError(res, 400)
  })

  test('first valid call ensures the assistant issue exists and updates its session state', async () => {
    const res = await post<AskResponse>('/api/cockpit/ask', { prompt: 'what is stuck?' })
    // The route may succeed (mocked engine in some setups) or 500 on a real engine error.
    // Either way it must NOT crash with a non-JSON response.
    expect(typeof res.json).toBe('object')
    expect(res.status === 200 || res.status === 500).toBe(true)

    // Regardless of executor result, the route should have ensured the singleton
    // and updated the issue row (executeIssue runs updateIssueSession BEFORE spawn).
    const singleton = expectSuccess(await get<SingletonResponse>('/api/cockpit/_singleton'))
    const [row] = await db
      .select({
        engineType: issuesTable.engineType,
        prompt: issuesTable.prompt,
      })
      .from(issuesTable)
      .where(and(eq(issuesTable.id, singleton.issueId), eq(issuesTable.isDeleted, 0)))
    expect(row).toBeDefined()
    // engineType is forced to claude-code-sdk by the route
    expect(row!.engineType).toBe('claude-code-sdk')
    // The first-turn prompt prepends the system prompt + the user request
    expect(row!.prompt).toContain('what is stuck?')
  })
})

describe('GET /api/cockpit/assistant + /project', () => {
  test('/assistant returns project metadata alongside issueId', async () => {
    const res = await get<{
      issueId: string
      projectId: string
      projectAlias: string
      projectName: string
    }>('/api/cockpit/assistant')
    const data = expectSuccess(res)
    expect(data.projectAlias).toBe('__cockpit__')
    expect(data.projectName).toContain('Cockpit')
    expect(data.issueId).toBeTruthy()
  })

  test('/project mirrors the underlying archived cockpit project record', async () => {
    const res = await get<{ id: string, alias: string, name: string }>('/api/cockpit/project')
    const data = expectSuccess(res)
    expect(data.alias).toBe('__cockpit__')
    expect(data.name).toContain('Cockpit')
  })
})
