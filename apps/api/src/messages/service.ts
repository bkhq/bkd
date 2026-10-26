import type {
  DecisionEventOption,
  Message,
  MessageExpects,
  MessageIssueLink,
  MessageKind,
  MessageLevel,
  MessageSource,
  MessageStatus,
} from '@bkd/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { issues as issuesTable, messages, projects as projectsTable } from '@/db/schema'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import { dispatchFollowUp } from '@/routes/issues/_shared'
import { toISO } from '@/utils/date'

export type MessageRow = typeof messages.$inferSelect
export type MessageInsert = typeof messages.$inferInsert
type MessageSet = Partial<MessageInsert>

function parse<T>(raw: string | null): T | null {
  return raw ? (JSON.parse(raw) as T) : null
}

/** The stored source; decisions raised through the v1 API also carry `type` and `bkdUrl`. */
export function parseSource(row: MessageRow): (MessageSource & { bkdUrl?: string }) | null {
  return parse(row.source)
}

export async function serializeMessages(rows: MessageRow[]): Promise<Message[]> {
  const sources = rows.map(parseSource)
  const issueIds = [
    ...new Set([
      ...sources.flatMap(s => (s ? [s.issueId] : [])),
      ...rows.flatMap(r => (r.ref ? [r.ref] : [])),
    ]),
  ]
  const projectIds = [...new Set(sources.flatMap(s => (s ? [s.projectId] : [])))]

  const issueRows = issueIds.length === 0
    ? []
    : await db
        .select({
          issueId: issuesTable.id,
          projectId: issuesTable.projectId,
          issueNumber: issuesTable.issueNumber,
          title: issuesTable.title,
        })
        .from(issuesTable)
        .where(and(inArray(issuesTable.id, issueIds), eq(issuesTable.isDeleted, 0)))
  const projectRows = projectIds.length === 0
    ? []
    : await db
        .select({ id: projectsTable.id, name: projectsTable.name })
        .from(projectsTable)
        .where(and(inArray(projectsTable.id, projectIds), eq(projectsTable.isDeleted, 0)))

  const issueById = new Map<string, MessageIssueLink>(issueRows.map(i => [i.issueId, i]))
  const projectNameById = new Map(projectRows.map(p => [p.id, p.name]))

  return rows.map((row, i) => {
    const source = sources[i] ?? null
    return {
      id: row.id,
      kind: row.kind as MessageKind,
      expects: row.expects as MessageExpects,
      status: row.status as MessageStatus,
      level: row.level as MessageLevel,
      campaignId: row.campaignId,
      source: source && { projectId: source.projectId, issueId: source.issueId },
      ref: row.ref,
      title: row.title,
      body: row.body,
      options: JSON.parse(row.options),
      recommendation: parse(row.recommendation),
      blocks: row.blocks,
      continues: row.continues,
      decision: parse(row.decision),
      reply: parse(row.reply),
      outcome: row.outcome,
      withdrawReason: row.withdrawReason,
      closeReason: row.closeReason,
      notifiedAt: row.notifiedAt ? toISO(row.notifiedAt) : null,
      links: {
        projectName: (source && projectNameById.get(source.projectId)) ?? null,
        ref: (row.ref && issueById.get(row.ref)) || null,
        source: (source && issueById.get(source.issueId)) ?? null,
      },
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
    }
  })
}

export async function serializeMessage(row: MessageRow): Promise<Message> {
  const [message] = await serializeMessages([row])
  return message!
}

export function emitMessageUpdated(row: MessageRow): void {
  appEvents.emit('message-updated', {
    id: row.id,
    kind: row.kind as MessageKind,
    expects: row.expects as MessageExpects,
    status: row.status as MessageStatus,
    campaignId: row.campaignId,
  })
}

/** Find the source issue, read fresh so follow-up routing sees its current status. */
export async function findSourceIssue(source: MessageSource) {
  const [issue] = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.id, source.issueId),
        eq(issuesTable.projectId, source.projectId),
        eq(issuesTable.isDeleted, 0),
      ),
    )
  return issue ?? null
}

/** The status a message awaiting a reply moves to once the user answers. */
export function answeredStatus(row: MessageRow): 'decided' | 'replied' {
  return row.kind === 'decision' ? 'decided' : 'replied'
}

function wakePrompt(row: MessageRow): string {
  if (row.kind === 'decision') return `[event-decision eventId=${row.id} campaignId=${row.campaignId}]`
  return `[message-reply messageId=${row.id}${row.campaignId ? ` campaignId=${row.campaignId}` : ''}]`
}

/**
 * Wake the source issue with a follow-up. The message is only a signal; the
 * sender re-reads the message. Returns the updated row, or null when the
 * follow-up could not be delivered.
 */
export async function wakeSource(row: MessageRow): Promise<MessageRow | null> {
  try {
    const source = parseSource(row)
    const issue = source && await findSourceIssue(source)
    if (!issue) {
      logger.warn({ messageId: row.id }, 'message_source_issue_missing')
      return null
    }
    const outcome = await dispatchFollowUp(issue, { prompt: wakePrompt(row), sender: { kind: 'system', via: 'message' } })
    if (!outcome.ok) {
      logger.warn({ messageId: row.id, error: outcome.error }, 'message_wake_rejected')
      return null
    }
    const [updated] = await db
      .update(messages)
      .set({ notifiedAt: new Date() })
      .where(eq(messages.id, row.id))
      .returning()
    return updated ?? null
  } catch (err) {
    logger.error({ messageId: row.id, err }, 'message_wake_failed')
    return null
  }
}

const notDeleted = eq(messages.isDeleted, 0)

export async function findMessage(id: string, kind?: MessageKind): Promise<MessageRow | null> {
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, id), notDeleted, kind ? eq(messages.kind, kind) : undefined))
  return row ?? null
}

/** Update a message only while it is in one of `from`; null when it has moved on. */
export async function updateFrom(
  id: string,
  from: MessageStatus[],
  set: MessageSet,
  kind?: MessageKind,
): Promise<MessageRow | null> {
  const [row] = await db
    .update(messages)
    .set(set)
    .where(and(
      eq(messages.id, id),
      notDeleted,
      inArray(messages.status, from),
      kind ? eq(messages.kind, kind) : undefined,
    ))
    .returning()
  if (row) emitMessageUpdated(row)
  return row ?? null
}

/**
 * Move a message to another status. Returns the row, or the status that
 * blocked the move (null when the message does not exist).
 */
export async function transition(
  id: string,
  from: MessageStatus[],
  set: MessageSet,
  kind?: MessageKind,
): Promise<{ row: MessageRow } | { blockedBy: string | null }> {
  const row = await updateFrom(id, from, set, kind)
  if (row) return { row }
  return { blockedBy: (await findMessage(id, kind))?.status ?? null }
}

export function hasOption(options: DecisionEventOption[], optionId: string): boolean {
  return options.some(o => o.id === optionId)
}

export async function insertMessage(values: MessageInsert): Promise<MessageRow> {
  const [row] = await db.insert(messages).values(values).returning()
  emitMessageUpdated(row!)
  return row!
}

// ── Send rate limit ─────────────────────────────────────

const SEND_LIMIT = 30
const SEND_WINDOW_MS = 60_000
const sendTimes = new Map<string, number[]>()

/** Count one notification against its sender; false once the sender is over the limit. */
export function takeSendSlot(sender: string): boolean {
  const now = Date.now()
  const recent = (sendTimes.get(sender) ?? []).filter(t => now - t < SEND_WINDOW_MS)
  if (recent.length >= SEND_LIMIT) {
    sendTimes.set(sender, recent)
    return false
  }
  recent.push(now)
  sendTimes.set(sender, recent)
  return true
}

export function resetSendLimits(): void {
  sendTimes.clear()
}

// ── Answers ─────────────────────────────────────────────

export type AnswerResult
  = | { ok: true, row: MessageRow, notified: boolean }
    | { ok: false, reason: 'not-found' }
    | { ok: false, reason: 'bad-option' }
    | { ok: false, reason: 'conflict', status: string }

// Whole seconds, like the integer timestamp columns, so it never sorts after notifiedAt
function answeredAt(): string {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()
}

async function answer(id: string, set: MessageSet): Promise<AnswerResult> {
  const answered = await updateFrom(id, ['open'], set)
  if (!answered) return { ok: false, reason: 'conflict', status: 'no longer open' }
  // The answer stands even when the wake signal fails; the sender's scan picks it up.
  const notified = await wakeSource(answered)
  return { ok: true, row: notified ?? answered, notified: notified !== null }
}

/** Record the user's answer on an open decision and wake the source issue. */
export async function decideMessage(
  id: string,
  input: { optionId: string | null, instruction: string, decidedBy: string },
): Promise<AnswerResult> {
  const existing = await findMessage(id, 'decision')
  if (!existing) return { ok: false, reason: 'not-found' }
  if (existing.status !== 'open') return { ok: false, reason: 'conflict', status: existing.status }
  if (input.optionId && !hasOption(JSON.parse(existing.options), input.optionId)) {
    return { ok: false, reason: 'bad-option' }
  }
  return answer(id, {
    status: 'decided',
    decision: JSON.stringify({ ...input, decidedAt: answeredAt() }),
  })
}

/** Record the user's reply on an open notification and wake the source issue. */
export async function replyMessage(
  id: string,
  input: { text: string, repliedBy: string },
): Promise<AnswerResult> {
  const existing = await findMessage(id, 'notification')
  if (!existing) return { ok: false, reason: 'not-found' }
  if (existing.expects !== 'reply') return { ok: false, reason: 'conflict', status: 'not awaiting a reply' }
  if (existing.status !== 'open') return { ok: false, reason: 'conflict', status: existing.status }
  return answer(id, {
    status: 'replied',
    reply: JSON.stringify({ ...input, repliedAt: answeredAt() }),
  })
}

/** Mark unread notifications read; all of them when `ids` is omitted. */
export async function markRead(ids?: string[]): Promise<MessageRow[]> {
  const rows = await db
    .update(messages)
    .set({ status: 'read' })
    .where(and(
      notDeleted,
      eq(messages.status, 'unread'),
      ids ? inArray(messages.id, ids) : undefined,
    ))
    .returning()
  for (const row of rows) emitMessageUpdated(row)
  return rows
}
