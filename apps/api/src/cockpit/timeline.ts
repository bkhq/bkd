import type {
  CockpitEnrichmentStatus,
  CockpitTimelineAction,
  CockpitTimelineDelta,
  CockpitTimelineMessage,
  CockpitTimelineMessageKind,
  CockpitTimelineMessageStatus,
  CockpitTimelineRecommendation,
} from '@bkd/shared'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  cockpitTimelineMessages,
  issues as issuesTable,
  projects as projectsTable,
} from '@/db/schema'
import { logger } from '@/logger'
import { toISO } from '@/utils/date'

export interface AppendInput {
  kind: CockpitTimelineMessageKind
  projectId?: string | null
  issueId?: string | null
  body: string
  actions?: CockpitTimelineAction[]
  signalKey: string
  /** Degradation-chain rung the card is appended at. Defaults to `template`. */
  enrichmentStatus?: CockpitEnrichmentStatus
  /** Recommendation available at append time (e.g. from `AskUserQuestion`). */
  recommendation?: CockpitTimelineRecommendation
}

type Subscriber = (delta: CockpitTimelineDelta) => void

const subscribers = new Set<Subscriber>()

function notify(delta: CockpitTimelineDelta): void {
  for (const fn of subscribers) {
    try {
      fn(delta)
    } catch (err) {
      logger.warn({ err }, 'cockpit_timeline_subscriber_error')
    }
  }
}

export function subscribeTimeline(fn: Subscriber): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

async function hydrate(row: typeof cockpitTimelineMessages.$inferSelect): Promise<CockpitTimelineMessage> {
  let projectAlias: string | null = null
  let issueNumber: number | null = null
  let issueTitle: string | null = null

  if (row.projectId) {
    const [p] = await db
      .select({ alias: projectsTable.alias })
      .from(projectsTable)
      .where(eq(projectsTable.id, row.projectId))
    if (p) projectAlias = p.alias
  }

  if (row.issueId) {
    const [i] = await db
      .select({ number: issuesTable.issueNumber, title: issuesTable.title })
      .from(issuesTable)
      .where(eq(issuesTable.id, row.issueId))
    if (i) {
      issueNumber = i.number
      issueTitle = i.title
    }
  }

  return {
    id: row.id,
    kind: row.kind as CockpitTimelineMessageKind,
    projectId: row.projectId ?? null,
    projectAlias,
    issueId: row.issueId ?? null,
    issueNumber,
    issueTitle,
    body: row.body,
    actions: safeParseActions(row.actions),
    signalKey: row.signalKey,
    status: row.status as CockpitTimelineMessageStatus,
    snoozedUntil: row.snoozedUntil ?? null,
    recommendation: safeParseRecommendation(row.recommendation),
    enrichedAt: row.enrichedAt != null ? toISO(row.enrichedAt) : null,
    enrichmentStatus: (row.enrichmentStatus ?? 'template') as CockpitEnrichmentStatus,
    enrichmentError: row.enrichmentError ?? null,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  }
}

function safeParseActions(raw: string): CockpitTimelineAction[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as CockpitTimelineAction[] : []
  } catch {
    return []
  }
}

function safeParseRecommendation(raw: string | null): CockpitTimelineRecommendation | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (
      parsed && typeof parsed === 'object'
      && typeof parsed.actionId === 'string'
      && typeof parsed.reasoning === 'string'
    ) {
      return { actionId: parsed.actionId, reasoning: parsed.reasoning }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Insert a new message. If a prior open message with the same signalKey
 * exists, mark it superseded first so the partial unique index stays clean.
 */
export async function appendOrReplace(input: AppendInput): Promise<CockpitTimelineMessage> {
  const now = new Date()

  // Mark existing open messages for the same signal as superseded.
  await db
    .update(cockpitTimelineMessages)
    .set({ status: 'superseded', updatedAt: now })
    .where(and(
      eq(cockpitTimelineMessages.signalKey, input.signalKey),
      eq(cockpitTimelineMessages.status, 'open'),
      eq(cockpitTimelineMessages.isDeleted, 0),
    ))

  const [row] = await db
    .insert(cockpitTimelineMessages)
    .values({
      kind: input.kind,
      projectId: input.projectId ?? null,
      issueId: input.issueId ?? null,
      body: input.body,
      actions: JSON.stringify(input.actions ?? []),
      signalKey: input.signalKey,
      status: 'open',
      enrichmentStatus: input.enrichmentStatus ?? 'template',
      recommendation: input.recommendation ? JSON.stringify(input.recommendation) : null,
    })
    .returning()

  if (!row) throw new Error('Failed to insert timeline message')
  const msg = await hydrate(row)
  notify({ op: 'append', message: msg })
  return msg
}

export interface ListOptions {
  limit?: number
  beforeMs?: number
}

export async function listMessages(opts: ListOptions = {}): Promise<CockpitTimelineMessage[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const nowMs = Date.now()

  const conditions = [
    eq(cockpitTimelineMessages.isDeleted, 0),
    inArray(cockpitTimelineMessages.status, ['open', 'acknowledged', 'snoozed']),
    // Snoozed-with-future-expiry are hidden until expiry; snoozed messages
    // whose snooze window has elapsed are eligible to surface again.
    or(
      sql`${cockpitTimelineMessages.status} != 'snoozed'`,
      sql`${cockpitTimelineMessages.snoozedUntil} IS NULL`,
      lt(cockpitTimelineMessages.snoozedUntil, nowMs),
    )!,
  ]
  if (opts.beforeMs != null) {
    conditions.push(lt(cockpitTimelineMessages.createdAt, new Date(opts.beforeMs)))
  }

  const rows = await db
    .select()
    .from(cockpitTimelineMessages)
    .where(and(...conditions))
    .orderBy(desc(cockpitTimelineMessages.createdAt))
    .limit(limit)

  return Promise.all(rows.map(hydrate))
}

async function transitionStatus(
  id: string,
  next: CockpitTimelineMessageStatus,
  patch: Partial<typeof cockpitTimelineMessages.$inferInsert> = {},
): Promise<CockpitTimelineMessage | null> {
  const now = new Date()
  const [row] = await db
    .update(cockpitTimelineMessages)
    .set({ status: next, updatedAt: now, ...patch })
    .where(and(
      eq(cockpitTimelineMessages.id, id),
      eq(cockpitTimelineMessages.isDeleted, 0),
    ))
    .returning()
  if (!row) return null
  const msg = await hydrate(row)
  notify({ op: 'update', message: msg })
  return msg
}

export function ack(id: string): Promise<CockpitTimelineMessage | null> {
  return transitionStatus(id, 'acknowledged')
}

export function dismiss(id: string): Promise<CockpitTimelineMessage | null> {
  return transitionStatus(id, 'dismissed')
}

export function snooze(id: string, untilMs: number): Promise<CockpitTimelineMessage | null> {
  return transitionStatus(id, 'snoozed', { snoozedUntil: untilMs })
}

export interface EnrichmentPatch {
  body: string
  actions: CockpitTimelineAction[]
  recommendation: CockpitTimelineRecommendation
}

/**
 * Apply a secretary enrichment to an existing card: replace body + actions,
 * attach the recommendation, and stamp `enrichedAt`. Only patches messages
 * still `open` — if the user already acted on the card the enrichment is
 * dropped. Emits an `update` delta so the UI patches the card in place.
 */
export async function applyEnrichment(
  id: string,
  patch: EnrichmentPatch,
): Promise<CockpitTimelineMessage | null> {
  const now = new Date()
  const [row] = await db
    .update(cockpitTimelineMessages)
    .set({
      body: patch.body,
      actions: JSON.stringify(patch.actions),
      recommendation: JSON.stringify(patch.recommendation),
      enrichedAt: now.getTime(),
      enrichmentStatus: 'enriched',
      enrichmentError: null,
      updatedAt: now,
    })
    .where(and(
      eq(cockpitTimelineMessages.id, id),
      eq(cockpitTimelineMessages.status, 'open'),
      eq(cockpitTimelineMessages.isDeleted, 0),
    ))
    .returning()
  if (!row) return null
  const msg = await hydrate(row)
  notify({ op: 'update', message: msg })
  return msg
}

/**
 * Record that AI enrichment was attempted on a card but did not succeed.
 * The card keeps whatever rung it was built at (`template`/`structured`);
 * only `enrichmentError` is set so the UI can explain the failure. Only
 * patches still-`open` cards. Emits an `update` delta.
 */
export async function recordEnrichmentError(
  id: string,
  reason: string,
): Promise<CockpitTimelineMessage | null> {
  const [row] = await db
    .update(cockpitTimelineMessages)
    .set({ enrichmentError: reason, updatedAt: new Date() })
    .where(and(
      eq(cockpitTimelineMessages.id, id),
      eq(cockpitTimelineMessages.status, 'open'),
      eq(cockpitTimelineMessages.isDeleted, 0),
    ))
    .returning()
  if (!row) return null
  const msg = await hydrate(row)
  notify({ op: 'update', message: msg })
  return msg
}

/** Internal — supersede any open message tied to an issueId (e.g. on cancel). */
export async function supersedeForIssue(issueId: string): Promise<void> {
  const now = new Date()
  const rows = await db
    .update(cockpitTimelineMessages)
    .set({ status: 'superseded', updatedAt: now })
    .where(and(
      eq(cockpitTimelineMessages.issueId, issueId),
      eq(cockpitTimelineMessages.status, 'open'),
      eq(cockpitTimelineMessages.isDeleted, 0),
    ))
    .returning()
  for (const row of rows) {
    const msg = await hydrate(row)
    notify({ op: 'update', message: msg })
  }
}

/** Open bucket counts for the status strip. */
export async function bucketCounts(): Promise<Record<CockpitTimelineMessageKind, number>> {
  const rows = await db
    .select({ kind: cockpitTimelineMessages.kind, count: sql<number>`count(*)` })
    .from(cockpitTimelineMessages)
    .where(and(
      eq(cockpitTimelineMessages.status, 'open'),
      eq(cockpitTimelineMessages.isDeleted, 0),
    ))
    .groupBy(cockpitTimelineMessages.kind)

  const out: Record<CockpitTimelineMessageKind, number> = {
    suggest_merge: 0,
    alert_off_track: 0,
    suggest_reply: 0,
    alert_repeat_fail: 0,
    alert_stale_working: 0,
    ack: 0,
    info: 0,
  }
  for (const r of rows) {
    const k = r.kind as CockpitTimelineMessageKind
    if (k in out) out[k] = Number(r.count)
  }
  return out
}
