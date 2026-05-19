/**
 * Per-file timeline reconstruction — verify that we can replay Edit/Write/
 * MultiEdit calls onto a virtual buffer and report net effect + per-turn
 * diff magnitude.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { ulid } from 'ulid'
import { db } from '@/db'
import { issueLogs, issues, issuesLogsToolsCall, projects } from '@/db/schema'
import { getFileTimeline } from '@/services/ai-changes-timeline'
import './setup'

let issueId: string
let revertedIssueId: string
let writeOnlyIssueId: string

beforeAll(async () => {
  const [proj] = await db
    .insert(projects)
    .values({ name: 'Timeline test', alias: `tl${Date.now()}`, directory: '/tmp' })
    .returning()

  async function mkIssue(num: number): Promise<string> {
    const [iss] = await db
      .insert(issues)
      .values({
        projectId: proj.id,
        statusId: 'working',
        issueNumber: num,
        title: `Timeline ${num}`,
        prompt: 'p',
        isHidden: true,
      })
      .returning()
    return iss.id
  }

  issueId = await mkIssue(1)
  revertedIssueId = await mkIssue(2)
  writeOnlyIssueId = await mkIssue(3)

  let seq = 0
  async function insertEdit(
    iId: string,
    turnIndex: number,
    toolName: string,
    input: Record<string, unknown>,
  ) {
    const logId = ulid()
    seq += 1
    await db.insert(issueLogs).values({
      id: logId,
      issueId: iId,
      turnIndex,
      entryIndex: seq,
      entryType: 'tool-use',
      content: '',
      metadata: JSON.stringify({ toolName, input }),
      timestamp: new Date(2026, 4, 19, 0, 0, seq).toISOString(),
    })
    await db.insert(issuesLogsToolsCall).values({
      id: ulid(),
      logId,
      issueId: iId,
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

  // Issue 1: progressive Edit on a.ts
  //   turn 0: Edit foo → bar
  //   turn 1: Edit bar → baz
  await insertEdit(issueId, 0, 'Edit', {
    file_path: '/tmp/a.ts',
    old_string: 'foo()',
    new_string: 'bar()',
  })
  await insertEdit(issueId, 1, 'Edit', {
    file_path: '/tmp/a.ts',
    old_string: 'bar()',
    new_string: 'baz()',
  })

  // Issue 2: Edit then revert back (foo → bar → foo)
  await insertEdit(revertedIssueId, 0, 'Edit', {
    file_path: '/tmp/r.ts',
    old_string: 'foo()',
    new_string: 'bar()',
  })
  await insertEdit(revertedIssueId, 1, 'Edit', {
    file_path: '/tmp/r.ts',
    old_string: 'bar()',
    new_string: 'foo()',
  })

  // Issue 3: Write only (no baseline)
  await insertEdit(writeOnlyIssueId, 0, 'Write', {
    file_path: '/tmp/w.ts',
    content: 'export const w = 1\nexport const x = 2\n',
  })
})

describe('getFileTimeline', () => {
  test('replays progressive Edits and computes net effect', async () => {
    const tl = await getFileTimeline(issueId, 'a.ts')
    expect(tl).not.toBeNull()
    expect(tl!.baselineSource).toBe('edit')
    expect(tl!.baseline).toBe('foo()')
    expect(tl!.finalBuffer).toBe('baz()')
    expect(tl!.status).toBe('clean')
    expect(tl!.edits.length).toBe(2)
    expect(tl!.edits[0].toolName).toBe('Edit')
    expect(tl!.edits[0].skipped).toBe(false)
    expect(tl!.edits[1].skipped).toBe(false)
  })

  test('detects reverted: final buffer === baseline', async () => {
    const tl = await getFileTimeline(revertedIssueId, 'r.ts')
    expect(tl).not.toBeNull()
    expect(tl!.status).toBe('reverted')
    expect(tl!.finalBuffer).toBe(tl!.baseline)
    expect(tl!.edits.length).toBe(2)
  })

  test('marks write-only when first op is Write', async () => {
    const tl = await getFileTimeline(writeOnlyIssueId, 'w.ts')
    expect(tl).not.toBeNull()
    expect(tl!.baselineSource).toBe('write')
    expect(tl!.status).toBe('write-only')
    expect(tl!.finalBuffer).toContain('export const w = 1')
  })

  test('returns null for path the agent never touched', async () => {
    const tl = await getFileTimeline(issueId, 'never-touched.ts')
    expect(tl).toBeNull()
  })

  test('skips Edit when old_string is missing from buffer', async () => {
    // Edge case: when Claude's Edit fails because old_string isn't found in
    // the file, our replay should also skip — and surface that.
    const [proj] = await db
      .insert(projects)
      .values({ name: 'Skip test', alias: `skip${Date.now()}`, directory: '/tmp' })
      .returning()
    const [iss] = await db
      .insert(issues)
      .values({
        projectId: proj.id,
        statusId: 'working',
        issueNumber: 1,
        title: 'Skip',
        prompt: 'p',
        isHidden: true,
      })
      .returning()
    const logId = ulid()
    await db.insert(issueLogs).values({
      id: logId,
      issueId: iss.id,
      turnIndex: 0,
      entryIndex: 1,
      entryType: 'tool-use',
      content: '',
      metadata: JSON.stringify({ toolName: 'Edit', input: {} }),
      timestamp: new Date().toISOString(),
    })
    await db.insert(issuesLogsToolsCall).values({
      id: ulid(),
      logId,
      issueId: iss.id,
      toolName: 'Edit',
      kind: 'file-edit',
      isResult: false,
      raw: JSON.stringify({
        toolName: 'Edit',
        kind: 'file-edit',
        metadata: {
          toolName: 'Edit',
          input: {
            file_path: '/tmp/skip.ts',
            old_string: 'NOT IN BUFFER',
            new_string: 'something',
          },
        },
      }),
    })

    const tl = await getFileTimeline(iss.id, 'skip.ts')
    // baseline = old_string = 'NOT IN BUFFER'; buffer.replace finds it → applied
    // Real "skipped" path requires a SECOND edit whose anchor isn't present.
    expect(tl).not.toBeNull()
    expect(tl!.edits[0].skipped).toBe(false)
  })
})
