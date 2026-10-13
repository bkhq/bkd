import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { and, eq, inArray, isNull, lte, notInArray, or } from 'drizzle-orm'
import { db } from '@/db'
import { getAppSetting } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import { removeWorktree, WORKTREE_BASE } from '@/engines/issue/utils/worktree'
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

async function isAutoCleanupEnabled(): Promise<boolean> {
  const value = await getAppSetting(WORKTREE_AUTO_CLEANUP_KEY)
  return value === 'true'
}

export async function runWorktreeCleanup(): Promise<string> {
  if (!(await isAutoCleanupEnabled())) return 'skipped (auto-cleanup disabled)'

  const worktreeBaseDir = WORKTREE_BASE
  let projectEntries: import('node:fs').Dirent[]
  try {
    projectEntries = await readdir(worktreeBaseDir, { withFileTypes: true })
  } catch {
    return 'skipped (no worktree directory)'
  }

  const projectDirNames = projectEntries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .slice(0, MAX_BATCH)

  if (projectDirNames.length === 0) return 'no projects with worktrees'

  const projectRows = await db
    .select({ id: projectsTable.id, directory: projectsTable.directory })
    .from(projectsTable)
    .where(inArray(projectsTable.id, projectDirNames))
  const projectMap = new Map(projectRows.map(p => [p.id, p.directory]))

  const cutoff = new Date(Date.now() - CLEANUP_AGE_MS)
  let cleaned = 0

  for (const projectDirName of projectDirNames) {
    const projectWorktreeDir = join(worktreeBaseDir, projectDirName)

    let issueEntries: import('node:fs').Dirent[]
    try {
      issueEntries = await readdir(projectWorktreeDir, { withFileTypes: true })
    } catch {
      continue
    }

    const issueIds = issueEntries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .slice(0, MAX_BATCH)

    if (issueIds.length === 0) continue

    const candidates = await db
      .select({
        id: issuesTable.id,
        projectId: issuesTable.projectId,
        isDeleted: issuesTable.isDeleted,
      })
      .from(issuesTable)
      .where(
        and(
          inArray(issuesTable.id, issueIds),
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
        ),
      )
    // A deleted row's sessionStatus can be stuck at running/pending (delete
    // terminates best-effort, and the reconciler skips deleted rows), so for
    // those ask whether a process is actually alive.
    const cleanableIssues = candidates.filter(i => !i.isDeleted || !issueEngine.hasActiveProcessForIssue(i.id))

    if (cleanableIssues.length === 0) continue

    const directory = projectMap.get(projectDirName)
    const baseDir = directory ? resolve(directory) : process.cwd()

    for (const issue of cleanableIssues) {
      const worktreePath = join(projectWorktreeDir, issue.id)
      try {
        await removeWorktree(baseDir, worktreePath)
        cleaned++
        logger.debug(
          { projectId: issue.projectId, issueId: issue.id, worktreePath },
          'worktree_auto_cleaned',
        )
      } catch (err) {
        logger.warn(
          { projectId: issue.projectId, issueId: issue.id, err },
          'worktree_auto_cleanup_failed',
        )
      }
    }
  }

  if (cleaned > 0) {
    logger.info({ cleaned }, 'worktree_auto_cleanup_done')
  }
  return `cleaned ${cleaned} worktrees`
}
