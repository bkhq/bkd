import type {
  DecisionEvent,
  DecisionEventIssueLink,
  DecisionEventNotify,
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
