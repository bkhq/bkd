import type {
  DecisionEvent,
  DecisionEventIssueLink,
  DecisionEventNotify,
  DecisionEventOption,
  DecisionEventStatus,
} from '@bkd/shared'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { decisionEvents, issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import { dispatchFollowUp } from '@/routes/issues/_shared'
import { toISO } from '@/utils/date'

export type DecisionEventRow = typeof decisionEvents.$inferSelect

function parse<T>(raw: string | null): T | null {
  return raw ? (JSON.parse(raw) as T) : null
}

export function parseNotify(row: DecisionEventRow): DecisionEventNotify {
  return JSON.parse(row.notify) as DecisionEventNotify
}

export async function serializeEvents(rows: DecisionEventRow[]): Promise<DecisionEvent[]> {
  const notifies = rows.map(parseNotify)
  const issueIds = [
    ...new Set([...notifies.map(n => n.issueId), ...rows.flatMap(r => (r.ref ? [r.ref] : []))]),
  ]
  const projectIds = [...new Set(notifies.map(n => n.projectId))]

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

  const issueById = new Map<string, DecisionEventIssueLink>(issueRows.map(i => [i.issueId, i]))
  const projectNameById = new Map(projectRows.map(p => [p.id, p.name]))

  return rows.map((row, i) => {
    const notify = notifies[i]!
    return {
      id: row.id,
      status: row.status as DecisionEventStatus,
      campaignId: row.campaignId,
      ref: row.ref,
      question: row.question,
      context: row.context,
      options: JSON.parse(row.options),
      recommendation: parse(row.recommendation),
      blocks: row.blocks,
      continues: row.continues,
      notify,
      decision: parse(row.decision),
      outcome: row.outcome,
      withdrawReason: row.withdrawReason,
      closeReason: row.closeReason,
      notifiedAt: row.notifiedAt ? toISO(row.notifiedAt) : null,
      links: {
        projectName: projectNameById.get(notify.projectId) ?? null,
        ref: (row.ref && issueById.get(row.ref)) || null,
        notify: issueById.get(notify.issueId) ?? null,
      },
      createdAt: toISO(row.createdAt),
      updatedAt: toISO(row.updatedAt),
    }
  })
}

export async function serializeEvent(row: DecisionEventRow): Promise<DecisionEvent> {
  const [event] = await serializeEvents([row])
  return event!
}

export function emitDecisionEventUpdated(row: DecisionEventRow): void {
  appEvents.emit('decision-event-updated', {
    id: row.id,
    campaignId: row.campaignId,
    status: row.status as DecisionEventStatus,
  })
}

/** Find the notify issue, read fresh so follow-up routing sees its current status. */
export async function findNotifyIssue(notify: DecisionEventNotify) {
  const [issue] = await db
    .select()
    .from(issuesTable)
    .where(
      and(
        eq(issuesTable.id, notify.issueId),
        eq(issuesTable.projectId, notify.projectId),
        eq(issuesTable.isDeleted, 0),
      ),
    )
  return issue ?? null
}

/**
 * Wake the notify issue with a follow-up. The message is only a signal; the
 * raiser re-reads the event. Returns the updated row, or null when the
 * follow-up could not be delivered.
 */
export async function notifyDecision(row: DecisionEventRow): Promise<DecisionEventRow | null> {
  try {
    const issue = await findNotifyIssue(parseNotify(row))
    if (!issue) {
      logger.warn({ eventId: row.id }, 'decision_event_notify_issue_missing')
      return null
    }
    const outcome = await dispatchFollowUp(issue, {
      prompt: `[event-decision eventId=${row.id} campaignId=${row.campaignId}]`,
    })
    if (!outcome.ok) {
      logger.warn({ eventId: row.id, error: outcome.error }, 'decision_event_notify_rejected')
      return null
    }
    const [updated] = await db
      .update(decisionEvents)
      .set({ notifiedAt: new Date() })
      .where(eq(decisionEvents.id, row.id))
      .returning()
    return updated ?? null
  } catch (err) {
    logger.error({ eventId: row.id, err }, 'decision_event_notify_failed')
    return null
  }
}

const notDeleted = eq(decisionEvents.isDeleted, 0)

export async function findEvent(id: string): Promise<DecisionEventRow | null> {
  const [row] = await db.select().from(decisionEvents).where(and(eq(decisionEvents.id, id), notDeleted))
  return row ?? null
}

/** Update an event only while it is in one of `from`; null when it has moved on. */
export async function updateFrom(
  id: string,
  from: DecisionEventStatus[],
  set: Partial<typeof decisionEvents.$inferInsert>,
): Promise<DecisionEventRow | null> {
  const [row] = await db
    .update(decisionEvents)
    .set(set)
    .where(and(eq(decisionEvents.id, id), notDeleted, inArray(decisionEvents.status, from)))
    .returning()
  if (row) emitDecisionEventUpdated(row)
  return row ?? null
}

export function hasOption(options: DecisionEventOption[], optionId: string): boolean {
  return options.some(o => o.id === optionId)
}

/**
 * Move an event to another status. Returns the row, or the status that
 * blocked the move (null when the event does not exist).
 */
export async function transition(
  eventId: string,
  from: DecisionEventStatus[],
  set: Partial<typeof decisionEvents.$inferInsert>,
): Promise<{ row: DecisionEventRow } | { blockedBy: string | null }> {
  const row = await updateFrom(eventId, from, set)
  if (row) return { row }
  return { blockedBy: (await findEvent(eventId))?.status ?? null }
}

export type DecideResult
  = | { ok: true, row: DecisionEventRow, notified: boolean }
    | { ok: false, reason: 'not-found' }
    | { ok: false, reason: 'bad-option' }
    | { ok: false, reason: 'conflict', status: string }

/** Record the user's answer on an open event and wake the notify issue. */
export async function decideEvent(
  id: string,
  input: { optionId: string | null, instruction: string, decidedBy: string },
): Promise<DecideResult> {
  const existing = await findEvent(id)
  if (!existing) return { ok: false, reason: 'not-found' }
  if (existing.status !== 'open') return { ok: false, reason: 'conflict', status: existing.status }
  if (input.optionId && !hasOption(JSON.parse(existing.options), input.optionId)) {
    return { ok: false, reason: 'bad-option' }
  }

  const decided = await updateFrom(id, ['open'], {
    status: 'decided',
    decision: JSON.stringify({
      optionId: input.optionId,
      instruction: input.instruction,
      decidedBy: input.decidedBy,
      // Whole seconds, like the integer timestamp columns, so it never sorts after notifiedAt
      decidedAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
    }),
  })
  if (!decided) return { ok: false, reason: 'conflict', status: 'no longer open' }

  // The decision stands even when the wake signal fails; the raiser's scan picks it up.
  const notified = await notifyDecision(decided)
  return { ok: true, row: notified ?? decided, notified: notified !== null }
}
