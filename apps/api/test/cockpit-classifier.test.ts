import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { classifyIssue, clearFailures, recordFailure } from '@/cockpit/classifier'
import { db } from '@/db'
import {
  cockpitTimelineMessages,
  issueLogs,
  issuesLogsToolsCall,
  issues as issuesTable,
} from '@/db/schema'
import { createTestProject, expectSuccess, post } from './helpers'
import './setup'

let projectId: string

async function makeIssue(statusId: 'todo' | 'working' | 'review' | 'done'): Promise<string> {
  // Create via the route (defaults to todo regardless of input on some
  // setups), then force the target status via direct DB update so the
  // classifier sees the state we want.
  const created = expectSuccess(await post<{ id: string }>(
    `/api/projects/${projectId}/issues`,
    { title: `t-${Date.now()}-${Math.random()}`, statusId: 'todo' },
  ))
  await db
    .update(issuesTable)
    .set({ statusId, statusUpdatedAt: new Date() })
    .where(eq(issuesTable.id, created.id))
  return created.id
}

async function appendLogEntry(issueId: string, opts: {
  turnIndex: number
  entryIndex: number
  entryType: string
  metadata?: string
  content?: string
}): Promise<void> {
  await db.insert(issueLogs).values({
    issueId,
    turnIndex: opts.turnIndex,
    entryIndex: opts.entryIndex,
    entryType: opts.entryType,
    content: opts.content ?? '',
    metadata: opts.metadata ?? null,
    visible: 1,
  })
}

beforeAll(async () => {
  projectId = await createTestProject('Classifier Test Project')
})

beforeEach(async () => {
  await db.delete(cockpitTimelineMessages)
})

describe('classifier — bucket selection', () => {
  test('returns null for non-review issues', async () => {
    const id = await makeIssue('working')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    const res = await classifyIssue(id, null, { trigger: 'cold-start' })
    expect(res).toBeNull()
  })

  test('suggests merge when assistant turn is clean and no AskUserQuestion', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res).not.toBeNull()
    expect(res!.message.kind).toBe('suggest_merge')
    expect(res!.message.signalKey).toContain('merge:')
  })

  test('AskUserQuestion in last turn diverts to suggest_reply (not merge)', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    await appendLogEntry(id, {
      turnIndex: 0,
      entryIndex: 1,
      entryType: 'tool-use',
      metadata: '{"toolName":"AskUserQuestion"}',
    })
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    // Must not propose merge — the engine is waiting on the user.
    expect(res?.message.kind).not.toBe('suggest_merge')
    expect(res?.message.kind).toBe('suggest_reply')
  })

  test('failed tool call in last turn blocks merge suggestion', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    await appendLogEntry(id, {
      turnIndex: 0,
      entryIndex: 1,
      entryType: 'tool-use',
      metadata: '{"toolName":"Bash","status":"failed"}',
    })
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res).toBeNull()
  })

  test('off-track diff (> 8 files) wins over merge', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    const res = await classifyIssue(
      id,
      { issueId: id, fileCount: 20, additions: 200, deletions: 30 },
      { trigger: 'changes-summary' },
    )
    expect(res).not.toBeNull()
    expect(res!.message.kind).toBe('alert_off_track')
  })

  test('small diff still yields suggest_merge', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    const res = await classifyIssue(
      id,
      { issueId: id, fileCount: 2, additions: 10, deletions: 1 },
      { trigger: 'changes-summary' },
    )
    expect(res?.message.kind).toBe('suggest_merge')
  })

  test('suggests reply when AskUserQuestion is the active question', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    await appendLogEntry(id, {
      turnIndex: 0,
      entryIndex: 1,
      entryType: 'tool-use',
      metadata: '{"toolName":"AskUserQuestion"}',
    })
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res?.message.kind).toBe('suggest_reply')
    expect(res?.message.actions?.some(a => a.kind === 'reply-input')).toBe(true)
  })

  test('AskUserQuestion with structured options yields a level-2 structured card', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    const [toolLog] = await db
      .insert(issueLogs)
      .values({
        issueId: id,
        turnIndex: 0,
        entryIndex: 1,
        entryType: 'tool-use',
        content: 'How should order status be stored?',
        metadata: '{"toolName":"AskUserQuestion"}',
        visible: 1,
      })
      .returning({ id: issueLogs.id })
    await db.insert(issuesLogsToolsCall).values({
      issueId: id,
      logId: toolLog!.id,
      toolName: 'AskUserQuestion',
      kind: 'user-question',
      raw: JSON.stringify({
        toolAction: {
          kind: 'user-question',
          recommendedIndex: 1,
          questions: [{
            question: 'How should order status be stored?',
            options: [
              { label: 'Enum column' },
              { label: 'Status table', description: 'More extensible' },
            ],
          }],
        },
      }),
    })

    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res?.message.kind).toBe('suggest_reply')
    expect(res?.message.enrichmentStatus).toBe('structured')
    const presets = (res?.message.actions ?? []).filter(a => a.kind === 'reply-preset')
    expect(presets).toHaveLength(2)
    expect(presets[0]!.payload).toEqual({ issueId: id, text: 'Enum column' })
    expect(res?.message.recommendation?.actionId).toBe('preset1')
  })

  test('AskUserQuestion without a tool-call row stays a level-3 template card', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    await appendLogEntry(id, {
      turnIndex: 0,
      entryIndex: 1,
      entryType: 'tool-use',
      metadata: '{"toolName":"AskUserQuestion"}',
    })
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res?.message.kind).toBe('suggest_reply')
    expect(res?.message.enrichmentStatus).toBe('template')
  })

  test('malformed AskUserQuestion tool-call raw falls back to a template card', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    const [toolLog] = await db
      .insert(issueLogs)
      .values({
        issueId: id,
        turnIndex: 0,
        entryIndex: 1,
        entryType: 'tool-use',
        content: '?',
        metadata: '{"toolName":"AskUserQuestion"}',
        visible: 1,
      })
      .returning({ id: issueLogs.id })
    await db.insert(issuesLogsToolsCall).values({
      issueId: id,
      logId: toolLog!.id,
      toolName: 'AskUserQuestion',
      kind: 'user-question',
      raw: 'not valid json{{{',
    })
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res?.message.kind).toBe('suggest_reply')
    expect(res?.message.enrichmentStatus).toBe('template')
  })

  test('AskUserQuestion with no options falls back to a template card', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    const [toolLog] = await db
      .insert(issueLogs)
      .values({
        issueId: id,
        turnIndex: 0,
        entryIndex: 1,
        entryType: 'tool-use',
        content: 'open question',
        metadata: '{"toolName":"AskUserQuestion"}',
        visible: 1,
      })
      .returning({ id: issueLogs.id })
    await db.insert(issuesLogsToolsCall).values({
      issueId: id,
      logId: toolLog!.id,
      toolName: 'AskUserQuestion',
      kind: 'user-question',
      raw: JSON.stringify({
        toolAction: {
          kind: 'user-question',
          questions: [{ question: 'What approach?', options: [] }],
        },
      }),
    })
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res?.message.kind).toBe('suggest_reply')
    expect(res?.message.enrichmentStatus).toBe('template')
  })

  test('hidden issues never produce a timeline card', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    await db.update(issuesTable).set({ isHidden: true }).where(eq(issuesTable.id, id))
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res).toBeNull()
  })

  test('repeat-failure tracker fires alert_repeat_fail once threshold reached', async () => {
    const id = await makeIssue('working')
    clearFailures(id)
    recordFailure(id)
    recordFailure(id)
    // Under threshold (3) → no alert yet.
    let res = await classifyIssue(id, null, { trigger: 'failure' })
    expect(res).toBeNull()
    recordFailure(id)
    res = await classifyIssue(id, null, { trigger: 'failure' })
    expect(res?.message.kind).toBe('alert_repeat_fail')
    clearFailures(id)
  })

  test('repeat-failure takes priority over review-status buckets', async () => {
    const id = await makeIssue('review')
    await appendLogEntry(id, { turnIndex: 0, entryIndex: 0, entryType: 'assistant-message' })
    clearFailures(id)
    recordFailure(id)
    recordFailure(id)
    recordFailure(id)
    const res = await classifyIssue(id, null, { trigger: 'review-transition' })
    expect(res?.message.kind).toBe('alert_repeat_fail')
    clearFailures(id)
  })

  test('stale trigger emits alert_stale_working only for working issues', async () => {
    const id = await makeIssue('working')
    const res = await classifyIssue(id, null, { trigger: 'stale' })
    expect(res?.message.kind).toBe('alert_stale_working')
    expect(res?.message.signalKey).toContain('stale:')
  })

  test('stale trigger ignores issues no longer in working state', async () => {
    const id = await makeIssue('review')
    const res = await classifyIssue(id, null, { trigger: 'stale' })
    expect(res?.message.kind).not.toBe('alert_stale_working')
  })

  test('ignores soft-deleted issues', async () => {
    const id = await makeIssue('review')
    await db.update(issuesTable).set({ isDeleted: 1 }).where(eq(issuesTable.id, id))
    const res = await classifyIssue(id, null, { trigger: 'cold-start' })
    expect(res).toBeNull()
  })
})
