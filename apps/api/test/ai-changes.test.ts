/**
 * GET /api/projects/:pid/issues/:iid/ai-changes — verify the AI-attributed
 * change extractor mines Edit/Write/MultiEdit tool calls out of the log
 * table and returns per-file aggregates independent of git status.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { ulid } from 'ulid'
import { db } from '@/db'
import { issueLogs, issues, issuesLogsToolsCall, projects } from '@/db/schema'
import { expectSuccess, get } from './helpers'
import './setup'

let projectId: string
let issueId: string

beforeAll(async () => {
  const [proj] = await db
    .insert(projects)
    .values({ name: 'AI-Changes Test', alias: `aichg${Date.now()}`, directory: '/tmp' })
    .returning()
  projectId = proj.id

  const [iss] = await db
    .insert(issues)
    .values({
      projectId,
      statusId: 'working',
      issueNumber: 1,
      title: 'Verify ai-changes',
      prompt: 'p',
      isHidden: true,
    })
    .returning()
  issueId = iss.id

  // Helper: insert a (issueLogs row + issuesLogsToolsCall row) pair as if the
  // engine had reported a tool invocation. We bypass the engine wholesale —
  // the extractor only reads from the DB.
  async function insertEdit(
    turnIndex: number,
    entryIndex: number,
    toolName: string,
    input: Record<string, unknown>,
  ) {
    const logId = ulid()
    await db.insert(issueLogs).values({
      id: logId,
      issueId,
      turnIndex,
      entryIndex,
      entryType: 'tool-use',
      content: '',
      metadata: JSON.stringify({ toolName, input }),
      timestamp: new Date(2026, 4, 19, 0, 0, entryIndex).toISOString(),
    })
    await db.insert(issuesLogsToolsCall).values({
      id: ulid(),
      logId,
      issueId,
      toolName,
      kind: 'file-edit',
      isResult: false,
      raw: JSON.stringify({
        toolName,
        kind: 'file-edit',
        metadata: { toolName, input },
        toolAction: { kind: 'file-edit', path: input.file_path },
      }),
    })
  }

  // a.ts edited twice across two turns (Edit then Edit again)
  await insertEdit(0, 1, 'Edit', {
    file_path: '/tmp/a.ts',
    old_string: 'const x = 1',
    new_string: 'const x = 2',
  })
  await insertEdit(1, 2, 'Edit', {
    file_path: '/tmp/a.ts',
    old_string: 'const x = 2',
    new_string: 'const x = 3',
  })
  // b.ts written from scratch (no old_string → status=created)
  await insertEdit(2, 3, 'Write', {
    file_path: '/tmp/b.ts',
    content: 'export const b = 1\n',
  })
  // c.ts written empty (status=maybe-deleted)
  await insertEdit(3, 4, 'Write', {
    file_path: '/tmp/c.ts',
    content: '',
  })
})

interface AiChangesResponse {
  root: string | null
  gitRepo: boolean
  timedOut: boolean
  onDisk: Array<{
    path: string
    editCount: number
    firstTurnIndex: number
    lastTurnIndex: number
    toolName: string
    status: string
  }>
  reverted: Array<{ path: string }>
  dirtyNotTouched: string[]
}

describe('GET /api/projects/:pid/issues/:iid/ai-changes', () => {
  test('returns 404 for unknown issue', async () => {
    const res = await get(`/api/projects/${projectId}/issues/nonexistent/ai-changes`)
    expect(res.status).toBe(404)
  })

  test('aggregates edits per file with turn metadata', async () => {
    const res = await get<AiChangesResponse>(
      `/api/projects/${projectId}/issues/${issueId}/ai-changes`,
    )
    const data = expectSuccess(res)
    // /tmp is not a git repo in CI usually — both onDisk and reverted contain
    // touched files depending on disk state, so combine the two for assertion.
    const all = [...data.onDisk, ...data.reverted]
    const byPath = new Map(all.map(f => [f.path, f]))

    const a = byPath.get('a.ts')
    expect(a).toBeDefined()
    expect(a!.editCount).toBe(2)
    expect(a!.firstTurnIndex).toBe(0)
    expect(a!.lastTurnIndex).toBe(1)
    expect(a!.toolName).toBe('Edit')
    expect(a!.status).toBe('edited')

    const b = byPath.get('b.ts')
    expect(b).toBeDefined()
    expect(b!.status).toBe('created')

    const c = byPath.get('c.ts')
    expect(c).toBeDefined()
    expect(c!.status).toBe('maybe-deleted')
  })

  test('paths are normalized relative to working directory', async () => {
    const res = await get<AiChangesResponse>(
      `/api/projects/${projectId}/issues/${issueId}/ai-changes`,
    )
    const data = expectSuccess(res)
    const all = [...data.onDisk, ...data.reverted]
    // All inserted paths used absolute `/tmp/X` — they should be relative
    // to the working directory in the response.
    for (const f of all) {
      expect(f.path.startsWith('/')).toBe(false)
    }
  })
})
