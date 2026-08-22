import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cacheDelByPrefix } from '@/cache'
import { createTestProject, expectError, expectSuccess, get, post } from './helpers'
import './setup'

/** Local session listing and session-to-issue import (SES-001). */

const ROOT = join(tmpdir(), `bkd-api-sessions-${process.pid}`)
const PROJECT_DIR = join(ROOT, 'workspace')
const SESSION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const OTHER_SESSION_ID = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee'
const ELSEWHERE_SESSION_ID = '99999999-bbbb-cccc-dddd-eeeeeeeeeeee'

interface SessionSummary {
  engine: string
  sessionId: string
  cwd: string
  title: string
  managedByIssueId?: string
  matchedProjectId?: string
}

function jsonl(lines: unknown[]): string {
  return `${lines.map(l => JSON.stringify(l)).join('\n')}\n`
}

function transcript(sessionId: string, cwd: string, prompt: string): string {
  return jsonl([
    {
      type: 'user',
      message: { role: 'user', content: prompt },
      cwd,
      sessionId,
      version: '2.1.231',
      gitBranch: 'main',
      timestamp: '2026-08-01T10:00:01.000Z',
    },
    {
      type: 'assistant',
      message: { id: 'msg_1', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'done' }] },
      timestamp: '2026-08-01T10:00:02.000Z',
    },
    {
      type: 'assistant',
      message: {
        id: 'msg_2',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.txt' } }],
      },
      timestamp: '2026-08-01T10:00:03.000Z',
    },
  ])
}

beforeAll(async () => {
  const projectsDir = join(ROOT, 'claude', 'projects', '-workspace')
  await mkdir(projectsDir, { recursive: true })
  await mkdir(PROJECT_DIR, { recursive: true })
  await writeFile(join(projectsDir, `${SESSION_ID}.jsonl`), transcript(SESSION_ID, PROJECT_DIR, 'ship the login page'))
  await writeFile(join(projectsDir, `${OTHER_SESSION_ID}.jsonl`), transcript(OTHER_SESSION_ID, '/somewhere/else', 'unrelated work'))
  await writeFile(join(projectsDir, `${ELSEWHERE_SESSION_ID}.jsonl`), transcript(ELSEWHERE_SESSION_ID, '/somewhere/else', 'work done elsewhere'))

  process.env.CLAUDE_CONFIG_DIR = join(ROOT, 'claude')
  process.env.CODEX_HOME = join(ROOT, 'codex')
  await cacheDelByPrefix('localSessions:')
})

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.CODEX_HOME
})

describe('GET /api/sessions', () => {
  test('lists local sessions with cwd and title', async () => {
    const data = expectSuccess(await get<{ sessions: SessionSummary[], total: number, hasMore: boolean }>('/api/sessions'))
    expect(data.total).toBe(3)
    expect(data.hasMore).toBe(false)
    expect(data.sessions.map(s => s.sessionId).sort()).toEqual([SESSION_ID, OTHER_SESSION_ID, ELSEWHERE_SESSION_ID].sort())
    expect(data.sessions.find(s => s.sessionId === SESSION_ID)?.title).toBe('ship the login page')
  })

  test('filters by search term', async () => {
    const data = expectSuccess(await get<{ sessions: SessionSummary[] }>('/api/sessions?search=unrelated'))
    expect(data.sessions).toHaveLength(1)
    expect(data.sessions[0]!.sessionId).toBe(OTHER_SESSION_ID)
  })

  test('filters by engine', async () => {
    const data = expectSuccess(await get<{ sessions: SessionSummary[] }>('/api/sessions?engine=codex'))
    expect(data.sessions).toHaveLength(0)
  })
})

describe('GET /api/sessions/:engine/:sessionId', () => {
  test('previews the normalized transcript', async () => {
    const data = expectSuccess(
      await get<{ entries: Array<{ entryType: string, content: string }>, totalEntries: number }>(
        `/api/sessions/claude-code/${SESSION_ID}`,
      ),
    )
    expect(data.totalEntries).toBeGreaterThan(0)
    expect(data.entries.some(e => e.content === 'ship the login page')).toBe(true)
  })

  test('404s for an unknown session', async () => {
    expectError(await get('/api/sessions/claude-code/does-not-exist'), 404)
  })
})

describe('POST /api/projects/:projectId/issues/import-session', () => {
  test('creates an issue bound to the session and backfills its logs', async () => {
    const projectId = await createTestProject('Session Import')
    // Point the project at the session cwd so the match is reported
    await post(`/api/projects/${projectId}`, {})
    const { db } = await import('@/db')
    const { projects } = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    db.update(projects).set({ directory: PROJECT_DIR }).where(eq(projects.id, projectId)).run()

    const result = await post<{
      issue: { id: string, externalSessionId: string | null, engineType: string | null, title: string }
      importedEntries: number
      cwdMatches: boolean
    }>(`/api/projects/${projectId}/issues/import-session`, {
      engine: 'claude-code',
      sessionId: SESSION_ID,
    })

    const data = expectSuccess(result)
    expect(result.status).toBe(201)
    expect(data.issue.externalSessionId).toBe(SESSION_ID)
    expect(data.issue.engineType).toBe('claude-code')
    expect(data.issue.title).toBe('ship the login page')
    expect(data.cwdMatches).toBe(true)
    expect(data.importedEntries).toBeGreaterThan(0)

    const logs = expectSuccess(
      await get<{ logs: Array<{ entryType: string, content: string }> }>(
        `/api/projects/${projectId}/issues/${data.issue.id}/logs`,
      ),
    )
    expect(logs.logs.some(l => l.content === 'ship the login page')).toBe(true)
    expect(logs.logs.some(l => l.entryType === 'tool-use')).toBe(true)
  })

  test('rejects a session that is already imported', async () => {
    const projectId = await createTestProject('Session Import Duplicate')
    const first = await post(`/api/projects/${projectId}/issues/import-session`, {
      engine: 'claude-code',
      sessionId: OTHER_SESSION_ID,
    })
    expectSuccess(first)

    const second = await post(`/api/projects/${projectId}/issues/import-session`, {
      engine: 'claude-code',
      sessionId: OTHER_SESSION_ID,
    })
    expect(expectError(second, 409)).toContain('already imported')
  })

  test('imports a session recorded elsewhere and reports the cwd mismatch', async () => {
    const projectId = await createTestProject('Session Import Mismatch')
    const data = expectSuccess(
      await post<{ cwdMatches: boolean, importedEntries: number }>(
        `/api/projects/${projectId}/issues/import-session`,
        { engine: 'claude-code', sessionId: ELSEWHERE_SESSION_ID, importLogs: false },
      ),
    )
    expect(data.cwdMatches).toBe(false)
    expect(data.importedEntries).toBe(0)
  })

  test('404s for an unknown session', async () => {
    const projectId = await createTestProject('Session Import Missing')
    expectError(
      await post(`/api/projects/${projectId}/issues/import-session`, {
        engine: 'claude-code',
        sessionId: 'nope',
      }),
      404,
    )
  })
})
