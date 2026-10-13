import { and, eq, lt, ne } from 'drizzle-orm'
import { db } from '@/db'
import { decisionEvents } from '@/db/schema'
import { emitDecisionEventUpdated } from '@/decisions/service'
import { logger } from '@/logger'

const RETENTION_MS = 24 * 60 * 60 * 1000

/** Soft-delete every non-open decision event untouched for a day. */
export async function runDecisionEventCleanup(): Promise<string> {
  const cutoff = new Date(Date.now() - RETENTION_MS)

  const removed = await db
    .update(decisionEvents)
    .set({ isDeleted: 1 })
    .where(
      and(
        ne(decisionEvents.status, 'open'),
        eq(decisionEvents.isDeleted, 0),
        lt(decisionEvents.updatedAt, cutoff),
      ),
    )
    .returning()

  for (const row of removed) emitDecisionEventUpdated(row)

  if (removed.length > 0) {
    logger.info({ deleted: removed.length }, 'decision_event_cleanup_done')
  }
  return `deleted ${removed.length} decision events`
}
