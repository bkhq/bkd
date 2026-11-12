import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { findProject } from '@/db/helpers'
import { issues as issuesTable } from '@/db/schema'
import { appEvents } from '@/events'
import { logger } from '@/logger'
import { collectChanges, resolveIssueDir } from '@/utils/changes'
import { isGitRepo } from '@/utils/git'

export type { ChangesSummary } from '@bkd/shared'

async function computeAndEmit(issueId: string): Promise<void> {
  try {
    const [issue] = await db
      .select({
        projectId: issuesTable.projectId,
        useWorktree: issuesTable.useWorktree,
      })
      .from(issuesTable)
      .where(eq(issuesTable.id, issueId))

    if (!issue) return

    const project = await findProject(issue.projectId)
    if (!project) return

    const projectRoot = project.directory ? resolve(project.directory) : process.cwd()
    try {
      const s = await stat(projectRoot)
      if (!s.isDirectory()) return
    } catch {
      return
    }

    // Resolve worktree path if applicable
    const root = await resolveIssueDir(issue.projectId, issueId, issue.useWorktree, projectRoot)
    // A missing worktree falls back to the main checkout, whose changes are not the issue's
    const worktreeMissing = issue.useWorktree && root === projectRoot

    if (worktreeMissing || !await isGitRepo(root)) {
      appEvents.emit('changes-summary', { issueId, fileCount: 0, additions: 0, deletions: 0 })
      return
    }

    const { files, additions, deletions } = await collectChanges(root)
    appEvents.emit('changes-summary', { issueId, fileCount: files.length, additions, deletions })
  } catch (err) {
    logger.error({ err, issueId }, 'changes_summary_compute_error')
  }
}

// --- Subscribe to engine events ---

let unsubscribeDone: (() => void) | null = null

export function startChangesSummaryWatcher(): void {
  // Only compute when session settles (completed/failed/cancelled)
  unsubscribeDone = appEvents.on('done', (data) => {
    void computeAndEmit(data.issueId)
  })

  logger.debug('changes_summary_watcher_started')
}

export function stopChangesSummaryWatcher(): void {
  if (unsubscribeDone) {
    unsubscribeDone()
    unsubscribeDone = null
    logger.debug('changes_summary_watcher_stopped')
  }
}
