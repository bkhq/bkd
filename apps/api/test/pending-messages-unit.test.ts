import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  deletePendingMessage,
  getPendingMessage,
  getPendingMessageById,
  getPendingMessages,
  markPendingMessagesDispatched,
  relocatePendingForProcessing,
  restorePendingVisibility,
  upsertPendingMessage,
} from '@/db/pending-messages'
import { attachments as attachmentsTable, issueLogs, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import './setup'

let projectId: string
let issueCounter = 0

async function createTestIssue(title?: string) {
  issueCounter++
  const [row] = await db
    .insert(issuesTable)
    .values({
      projectId,
      statusId: 'todo',
      issueNumber: issueCounter,
      title: title ?? `Pending Test Issue ${issueCounter}`,
      engineType: 'codex',
      model: 'auto',
      prompt: 'test',
    })
    .returning()
  return row!
}

beforeAll(async () => {
  const [p] = await db
    .insert(projectsTable)
    .values({
      name: 'Pending Unit Test Project',
      alias: `pending-unit-${Date.now()}`,
    })
    .returning()
  projectId = p!.id
})

describe('pending message storage', () => {
  test('stores multiple pending rows independently', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    expect(firstId).not.toBe(secondId)

    const pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(2)
    expect(pending.map(row => row.id)).toEqual([firstId, secondId])
    expect(pending.map(row => row.content)).toEqual(['first pending', 'second pending'])
  })

  test('preserves non-pending queued types when inserting', async () => {
    const issue = await createTestIssue()

    const messageId = await upsertPendingMessage(issue.id, 'done message', { type: 'done' })
    const [row] = await db
      .select({ metadata: issueLogs.metadata })
      .from(issueLogs)
      .where(eq(issueLogs.id, messageId))

    expect(row).toBeTruthy()
    expect(JSON.parse(row!.metadata!)).toEqual({ type: 'done' })
    const queued = await getPendingMessages(issue.id)
    expect(queued).toHaveLength(1)
    expect(queued[0]?.id).toBe(messageId)
  })

  test('getPendingMessage returns the oldest visible pending row', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    const oldest = await getPendingMessage(issue.id)
    expect(oldest?.id).toBe(firstId)
    expect(oldest?.content).toBe('first pending')
  })

  test('getPendingMessageById returns visible queueable rows only', async () => {
    const issue = await createTestIssue()

    const pendingId = await upsertPendingMessage(issue.id, 'visible pending', { type: 'pending' })
    const doneId = await upsertPendingMessage(issue.id, 'done row', { type: 'done' })

    expect((await getPendingMessageById(issue.id, pendingId))?.id).toBe(pendingId)
    expect((await getPendingMessageById(issue.id, doneId))?.id).toBe(doneId)
  })
})

describe('pending message recall', () => {
  test('deletes only the targeted pending row', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    const recalled = await deletePendingMessage(issue.id, secondId)
    expect(recalled?.id).toBe(secondId)
    expect(recalled?.content).toBe('second pending')

    const remaining = await getPendingMessages(issue.id)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(firstId)
  })

  test('allows recalling a queued done message by messageId', async () => {
    const issue = await createTestIssue()
    const doneId = await upsertPendingMessage(issue.id, 'done recall', { type: 'done' })

    const recalled = await deletePendingMessage(issue.id, doneId)
    expect(recalled?.id).toBe(doneId)
    expect(recalled?.metadata).toEqual({ type: 'done' })
    expect(await getPendingMessages(issue.id)).toHaveLength(0)
  })

  test('recalls a pending message that has an attachment', async () => {
    const issue = await createTestIssue()
    const pendingId = await upsertPendingMessage(issue.id, 'with image', { type: 'pending' })
    await db.insert(attachmentsTable).values({
      issueId: issue.id,
      logId: pendingId,
      originalName: 'image.png',
      storedName: 'stored.png',
      mimeType: 'image/png',
      size: 1024,
      storagePath: '/tmp/stored.png',
    })

    const recalled = await deletePendingMessage(issue.id, pendingId)
    expect(recalled?.id).toBe(pendingId)
    expect(recalled?.attachments.map(a => a.originalName)).toEqual(['image.png'])
    expect(await getPendingMessages(issue.id)).toHaveLength(0)
    expect(await db.select().from(attachmentsTable).where(eq(attachmentsTable.logId, pendingId))).toHaveLength(0)
  })
})

describe('pending message dispatch', () => {
  test('relocates all pending rows at once and merges prompts', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated?.oldIds).toEqual([firstId, secondId])
    expect(relocated?.prompt).toBe('first pending\n\nsecond pending')
    expect(relocated?.displayPrompt).toBe('first pending\n\nsecond pending')

    const pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(0)

    // No more pending messages to relocate
    const empty = await relocatePendingForProcessing(issue.id)
    expect(empty).toBeNull()
  })

  test('relocates only the leading run from one sender, leaving the rest queued', async () => {
    const issue = await createTestIssue()
    const agent = { kind: 'agent', projectId, issueId: 'l2issue1' }

    const userA = await upsertPendingMessage(issue.id, 'user a', { type: 'pending' })
    const userB = await upsertPendingMessage(issue.id, 'user b', { type: 'pending' })
    const fromAgent = await upsertPendingMessage(issue.id, 'agent task', { type: 'pending', sender: agent })

    const first = await relocatePendingForProcessing(issue.id)
    expect(first?.oldIds).toEqual([userA, userB])
    expect(first?.prompt).toBe('user a\n\nuser b')
    expect(first?.metadata.sender).toBeUndefined()

    const second = await relocatePendingForProcessing(issue.id)
    expect(second?.oldIds).toEqual([fromAgent])
    expect(second?.metadata.sender).toEqual(agent)
    expect(await relocatePendingForProcessing(issue.id)).toBeNull()
  })

  test('flushes consecutive runs in order: agent run, the user in between, the next agent run', async () => {
    const issue = await createTestIssue()
    const agent = { kind: 'agent', projectId, issueId: 'l2issue1' }
    const queue = (text: string, sender?: object) =>
      upsertPendingMessage(issue.id, text, { type: 'pending', ...(sender ? { sender } : {}) })

    await queue('a1', agent)
    await queue('a2', agent)
    await queue('a3', agent)
    await queue('u1')
    await queue('a4', agent)
    await queue('a5', agent)

    const batches: string[] = []
    for (let r = await relocatePendingForProcessing(issue.id); r; r = await relocatePendingForProcessing(issue.id))
      batches.push(r.prompt)
    expect(batches).toEqual(['a1\n\na2\n\na3', 'u1', 'a4\n\na5'])
  })

  test('merges attachments metadata from all pending messages', async () => {
    const issue = await createTestIssue()

    const att1 = { id: 'a1', name: 'file1.txt', mimeType: 'text/plain', size: 100 }
    const att2 = { id: 'a2', name: 'file2.png', mimeType: 'image/png', size: 200 }

    await upsertPendingMessage(issue.id, 'msg with file1', {
      type: 'pending',
      attachments: [att1],
    })
    await upsertPendingMessage(issue.id, 'msg with file2', {
      type: 'pending',
      attachments: [att2],
    })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated).not.toBeNull()
    expect(relocated!.metadata.attachments).toEqual([att1, att2])
    expect(relocated!.prompt).toBe('msg with file1\n\nmsg with file2')
  })

  test('merges metadata without attachments when none present', async () => {
    const issue = await createTestIssue()

    await upsertPendingMessage(issue.id, 'plain msg', { type: 'pending' })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated).not.toBeNull()
    expect(relocated!.metadata.attachments).toBeUndefined()
  })

  test('restorePendingVisibility makes a failed relocation retryable', async () => {
    const issue = await createTestIssue()
    const pendingId = await upsertPendingMessage(issue.id, 'retry me', { type: 'pending' })

    const relocated = await relocatePendingForProcessing(issue.id)
    expect(relocated?.oldIds).toEqual([pendingId])
    expect(await getPendingMessages(issue.id)).toHaveLength(0)

    restorePendingVisibility(relocated!.oldIds)

    const pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe(pendingId)
  })

  test('markPendingMessagesDispatched hides only the provided IDs', async () => {
    const issue = await createTestIssue()

    const firstId = await upsertPendingMessage(issue.id, 'first pending', { type: 'pending' })
    const secondId = await upsertPendingMessage(issue.id, 'second pending', { type: 'pending' })

    await markPendingMessagesDispatched([firstId])

    const pending = await getPendingMessages(issue.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe(secondId)
  })
})
