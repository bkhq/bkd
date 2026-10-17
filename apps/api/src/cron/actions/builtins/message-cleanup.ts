import { and, eq, inArray, lt, ne, or } from 'drizzle-orm'
import { db } from '@/db'
import { messages } from '@/db/schema'
import { logger } from '@/logger'
import { emitMessageUpdated } from '@/messages/service'

const DAY_MS = 24 * 60 * 60 * 1000
const SETTLED_RETENTION_MS = DAY_MS
const READ_RETENTION_MS = 7 * DAY_MS

const TERMINAL_STATUSES = ['applied', 'withdrawn', 'closed']

/**
 * Soft-delete settled messages (untouched for a day) and read notifications
 * (untouched for a week). Open, answered and unread ones stay.
 */
export async function runMessageCleanup(): Promise<string> {
  const now = Date.now()

  const removed = await db
    .update(messages)
    .set({ isDeleted: 1 })
    .where(
      and(
        eq(messages.isDeleted, 0),
        or(
          and(
            eq(messages.expects, 'reply'),
            inArray(messages.status, TERMINAL_STATUSES),
            lt(messages.updatedAt, new Date(now - SETTLED_RETENTION_MS)),
          ),
          and(
            eq(messages.expects, 'none'),
            ne(messages.status, 'unread'),
            lt(messages.updatedAt, new Date(now - READ_RETENTION_MS)),
          ),
        ),
      ),
    )
    .returning()

  for (const row of removed) emitMessageUpdated(row)

  if (removed.length > 0) {
    logger.info({ deleted: removed.length }, 'message_cleanup_done')
  }
  return `deleted ${removed.length} messages`
}
