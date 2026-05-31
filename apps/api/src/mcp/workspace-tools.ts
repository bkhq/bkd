import { and, eq, max } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { db } from '@/db'
import { issues as issuesTable } from '@/db/schema'
import { appEvents } from '@/events'
import { createEngineContext } from '@/engines/issue/context'
import { followUpIssue } from '@/engines/issue/orchestration/follow-up'

interface ToolText {
  content: Array<{ type: 'text', text: string }>
}

function ok<T>(value: T): ToolText {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function err(message: string): ToolText {
  return { content: [{ type: 'text', text: `Error: ${message}` }] }
}

const readableId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

// ---------- bkdQueryIssue ----------

export async function bkdQueryIssue(params: { issueId: string }): Promise<ToolText> {
  const [row] = await db
    .select({
      id: issuesTable.id,
      projectId: issuesTable.projectId,
      title: issuesTable.title,
      statusId: issuesTable.statusId,
      sessionStatus: issuesTable.sessionStatus,
      prompt: issuesTable.prompt,
      engineType: issuesTable.engineType,
      model: issuesTable.model,
      parentIssueId: issuesTable.parentIssueId,
      totalInputTokens: issuesTable.totalInputTokens,
      totalOutputTokens: issuesTable.totalOutputTokens,
      totalCostUsd: issuesTable.totalCostUsd,
      statusUpdatedAt: issuesTable.statusUpdatedAt,
    })
    .from(issuesTable)
    .where(and(eq(issuesTable.id, params.issueId), eq(issuesTable.isDeleted, 0)))
  if (!row) return err(`Issue not found: ${params.issueId}`)
  return ok(row)
}

// ---------- bkdTriggerIssue ----------

export async function bkdTriggerIssue(params: {
  issueId: string
  prompt: string
}): Promise<ToolText> {
  const [issue] = await db
    .select({ id: issuesTable.id, projectId: issuesTable.projectId })
    .from(issuesTable)
    .where(and(eq(issuesTable.id, params.issueId), eq(issuesTable.isDeleted, 0)))
  if (!issue) return err(`Issue not found: ${params.issueId}`)

  const ctx = createEngineContext()
  const result = await followUpIssue(ctx, params.issueId, params.prompt)
  return ok({ messageId: result.messageId, executionId: result.executionId })
}

// ---------- bkdListChildren ----------

export async function bkdListChildren(params: {
  parentIssueId: string
}): Promise<ToolText> {
  const rows = await db
    .select({
      id: issuesTable.id,
      title: issuesTable.title,
      statusId: issuesTable.statusId,
      sessionStatus: issuesTable.sessionStatus,
    })
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.parentIssueId, params.parentIssueId),
        eq(issuesTable.isDeleted, 0),
      ),
    )
  return ok(rows)
}

// ---------- bkdCreateIssue ----------

export async function bkdCreateIssue(params: {
  projectId: string
  title: string
  prompt?: string
  parentIssueId?: string
}): Promise<ToolText> {
  const [maxNumRow] = await db
    .select({ maxNum: max(issuesTable.issueNumber) })
    .from(issuesTable)
    .where(eq(issuesTable.projectId, params.projectId))
  const issueNumber = (maxNumRow?.maxNum ?? 0) + 1
  const id = readableId()

  await db.insert(issuesTable).values({
    id,
    projectId: params.projectId,
    statusId: 'todo',
    issueNumber,
    title: params.title,
    prompt: params.prompt ?? params.title,
    parentIssueId: params.parentIssueId ?? null,
    sortOrder: 'a0',
  })

  return ok({ id, title: params.title })
}

// ---------- bkdLinkIssues ----------

export async function bkdLinkIssues(params: {
  childIssueId: string
  parentIssueId: string
}): Promise<ToolText> {
  await db
    .update(issuesTable)
    .set({ parentIssueId: params.parentIssueId, updatedAt: new Date() })
    .where(eq(issuesTable.id, params.childIssueId))
  return ok({ linked: true })
}

// ---------- bkdNotifyRoom ----------

export async function bkdNotifyRoom(params: {
  roomType: string
  message: string
}): Promise<ToolText> {
  appEvents.emit('room:notify', {
    roomType: params.roomType,
    message: params.message,
    timestamp: Date.now(),
  })
  return ok({ notified: true })
}
