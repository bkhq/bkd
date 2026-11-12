import { and, eq, inArray, isNull, lte, notInArray, or } from 'drizzle-orm'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { listWorktreesOnDisk, removeWorktrees } from '@/engines/issue/utils/worktree'
import { logger } from '@/logger'

export const WORKTREE_AUTO_CLEANUP_KEY = 'worktree:autoCleanup'

/**
 * Only clean up worktrees for issues done, or deleted, for at least 1 day.
 * Deleted issues keep their worktree inside that window so a recycle-bin
 * restore is lossless.
 */
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000

/** Max entries per inArray batch to stay within SQLite variable limits */
const MAX_BATCH = 500

/** Issues whose worktree may go: done for a while (and idle), or deleted for a while. */
function cleanableWhere(cutoff: Date) {
  return and(
    eq(issuesTable.useWorktree, true),
    or(
      and(
        eq(issuesTable.statusId, 'done'),
        eq(issuesTable.isDeleted, 0),
        lte(issuesTable.statusUpdatedAt, cutoff),
        or(
          isNull(issuesTable.sessionStatus),
          notInArray(issuesTable.sessionStatus, ['running', 'pending']),
        ),
      ),
      // The soft delete bumps `updatedAt`, and nothing writes a deleted
      // issue afterwards, so it stands in for the deletion time.
      and(eq(issuesTable.isDeleted, 1), lte(issuesTable.updatedAt, cutoff)),
    ),
  )
}

/**
 * Synchronous re-check of one issue. A deleted row's sessionStatus can be
 * stuck at running/pending (delete terminates best-effort, and the reconciler
 * skips deleted rows), so for those ask whether a process is actually alive.
 */
function isStillCleanable(issueId: string, cutoff: Date): boolean {
  const row = db
    .select({ isDeleted: issuesTable.isDeleted })
    .from(issuesTable)
    .where(and(eq(issuesTable.id, issueId), cleanableWhere(cutoff)))
    .get()
  return !!row && (!row.isDeleted || !issueEngine.hasActiveProcessForIssue(issueId))
}

async function isAutoCleanupEnabled(): Promise<boolean> {
  const value = await getAppSetting(WORKTREE_AUTO_CLEANUP_KEY)
  return value === 'true'
}

export async function runWorktreeCleanup(): Promise<string> {
  if (!(await isAutoCleanupEnabled())) return 'skipped (auto-cleanup disabled)'

  const onDisk = await listWorktreesOnDisk()
  if (onDisk.length === 0) return 'no worktrees on disk'

  const cutoff = new Date(Date.now() - CLEANUP_AGE_MS)
  const issueIds = [...new Set(onDisk.map(w => w.issueId))]
  const cleanableIds = new Set<string>()
  for (let i = 0; i < issueIds.length; i += MAX_BATCH) {
    const candidates = await db
      .select({ id: issuesTable.id, isDeleted: issuesTable.isDeleted })
      .from(issuesTable)
      .where(and(inArray(issuesTable.id, issueIds.slice(i, i + MAX_BATCH)), cleanableWhere(cutoff)))
    for (const c of candidates) {
      if (!c.isDeleted || !issueEngine.hasActiveProcessForIssue(c.id)) cleanableIds.add(c.id)
    }
  }

  // Earlier removals are awaited, so the issue may have been restored (or
  // re-spawned) since the candidates were read: re-check it right before its
  // worktree goes, keeping the filesystem work outside any transaction
  const cleaned = await removeWorktrees(
    onDisk.filter(w => cleanableIds.has(w.issueId)),
    issueId => isStillCleanable(issueId, cutoff),
  )

  if (cleaned > 0) {
    logger.info({ cleaned }, 'worktree_auto_cleanup_done')
  }
  return `cleaned ${cleaned} worktrees`
}
