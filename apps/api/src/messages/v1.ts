import type { DecisionEvent, DecisionEventStatus, Message } from '@bkd/shared'
import type { MessageRow } from './service'
import { parseSource, serializeMessages } from './service'

/** A decision message in the v1 decision-event shape (`/api/decisions`, `decision.*` webhooks). */
export function toDecisionEvent(message: Message, row: MessageRow): DecisionEvent {
  const source = parseSource(row)!
  return {
    id: message.id,
    status: message.status as DecisionEventStatus,
    campaignId: message.campaignId ?? '',
    ref: message.ref,
    question: message.title,
    context: message.body,
    options: message.options,
    recommendation: message.recommendation,
    blocks: message.blocks,
    continues: message.continues,
    notify: {
      type: 'bkd-follow-up',
      ...(source.bkdUrl !== undefined && { bkdUrl: source.bkdUrl }),
      projectId: source.projectId,
      issueId: source.issueId,
    },
    decision: message.decision,
    outcome: message.outcome,
    withdrawReason: message.withdrawReason,
    closeReason: message.closeReason,
    notifiedAt: message.notifiedAt,
    links: {
      projectName: message.links.projectName,
      ref: message.links.ref,
      notify: message.links.source,
    },
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  }
}

export async function serializeDecisionEvents(rows: MessageRow[]): Promise<DecisionEvent[]> {
  const serialized = await serializeMessages(rows)
  return serialized.map((message, i) => toDecisionEvent(message, rows[i]!))
}

export async function serializeDecisionEvent(row: MessageRow): Promise<DecisionEvent> {
  const [event] = await serializeDecisionEvents([row])
  return event!
}
