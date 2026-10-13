import { beforeAll, describe, expect, test } from 'bun:test'
import { db } from '@/db'
import { issueLogs } from '@/db/schema'
import { createTestIssue, createTestProject, expectError, expectSuccess, get } from './helpers'
/**
 * GET /api/projects/:projectId/issues/:id/turns — one summary per chat turn,
 * so the turn navigator can list history that is not loaded yet.
 */
import './setup'

interface TurnSummary { messageId: string, userText: string, replyText: string, entriesSince: number }

let projectId = ''
let issueId = ''
let seq = 0

function logId(): string {
  return `01J${String(++seq).padStart(23, '0')}`
}

async function addLog(entryType: string, content: string, opts: { metadata?: object, visible?: number } = {}): Promise<string> {
  const id = logId()
  await db.insert(issueLogs).values({
    id,
    issueId,
    entryIndex: seq,
    entryType,
    content,
    metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    visible: opts.visible ?? 1,
  })
  return id
}

let first = ''
let second = ''
let third = ''

beforeAll(async () => {
  projectId = await createTestProject('Turns Project')
  issueId = expectSuccess(await createTestIssue(projectId, { title: 'Turns issue' })).id as string

  first = await addLog('user-message', 'First question')
  await addLog('thinking', 'pondering')
  await addLog('assistant-message', 'First answer')
  await addLog('assistant-message', 'More of the first answer')
  await addLog('user-message', 'meta follow-up', { metadata: { type: 'system' } })
  await addLog('user-message', 'subagent prompt', { metadata: { subagent: { toolCallId: 'call-1' } } })
  await addLog('assistant-message', 'subagent reply', { metadata: { subagent: { toolCallId: 'call-1' } } })
  second = await addLog('user-message', 'x'.repeat(500))
  await addLog('tool-use', 'ls')
  await addLog('user-message', 'hidden', { visible: 0 })
  third = await addLog('user-message', 'Third question')
  await addLog('assistant-message', 'Third answer')
  await addLog('user-message', 'queued', { metadata: { type: 'pending' } })
})

describe('GET /api/projects/:projectId/issues/:id/turns', () => {
  test('lists every turn oldest first with its first reply', async () => {
    const turns = expectSuccess(await get<{ turns: TurnSummary[] }>(`/api/projects/${projectId}/issues/${issueId}/turns`)).turns

    expect(turns.map(t => t.messageId)).toEqual([first, second, third])
    expect(turns[0]).toMatchObject({ userText: 'First question', replyText: 'First answer' })
    expect(turns[1].userText).toHaveLength(300)
    expect(turns[1].replyText).toBe('')
    expect(turns[2]).toMatchObject({ userText: 'Third question', replyText: 'Third answer' })
  })

  test('counts the visible entries from each turn to the newest one', async () => {
    const turns = expectSuccess(await get<{ turns: TurnSummary[] }>(`/api/projects/${projectId}/issues/${issueId}/turns`)).turns

    // 13 entries, one hidden: 12 visible; the third turn has itself, its reply and the queued message.
    expect(turns.map(t => t.entriesSince)).toEqual([12, 5, 3])
  })

  test('rejects an issue from another project', async () => {
    const otherProject = await createTestProject('Other Project')
    expectError(await get(`/api/projects/${otherProject}/issues/${issueId}/turns`), 404)
  })
})
