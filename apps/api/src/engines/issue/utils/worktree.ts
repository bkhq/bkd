import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { WORKTREE_DIR } from '@/engines/issue/constants'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'

// ---------- Git worktree helpers ----------

/**
 * Deterministic worktree path: `<ROOT_DIR>/data/worktrees/<projectId>/<issueId>/`
 */
export function resolveWorktreePath(
  projectId: string,
  issueId: string,
): string {
  return join(ROOT_DIR, WORKTREE_DIR, projectId, issueId)
}

export async function createWorktree(
  baseDir: string,
  projectId: string,
  issueId: string,
): Promise<string> {
  const branchName = `bitk/${issueId}`
  const worktreeDir = resolveWorktreePath(projectId, issueId)
  await mkdir(join(ROOT_DIR, WORKTREE_DIR, projectId), { recursive: true })

  // Create worktree with a new branch off HEAD
  const proc = Bun.spawn(
    ['git', 'worktree', 'add', '-b', branchName, worktreeDir],
    {
      cwd: baseDir,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const code = await proc.exited
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text()
    // Branch may already exist from a previous run — try without -b
    const retry = Bun.spawn(
      ['git', 'worktree', 'add', worktreeDir, branchName],
      {
        cwd: baseDir,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const retryCode = await retry.exited
    if (retryCode !== 0) {
      const retryErr = await new Response(retry.stderr).text()
      throw new Error(
        `Failed to create worktree: ${stderr.trim()} / ${retryErr.trim()}`,
      )
    }
  }
  logger.debug({ issueId, worktreeDir, branchName }, 'worktree_created')
  return worktreeDir
}

export async function removeWorktree(
  baseDir: string,
  worktreeDir: string,
): Promise<void> {
  try {
    const proc = Bun.spawn(
      ['git', 'worktree', 'remove', '--force', worktreeDir],
      {
        cwd: baseDir,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const code = await proc.exited
    if (code !== 0) {
      throw new Error(`git worktree remove exited with code ${code}`)
    }
    logger.debug({ worktreeDir }, 'worktree_removed')
  } catch (error) {
    logger.warn({ worktreeDir, error }, 'worktree_remove_failed')
    // Fallback: just delete the directory
    try {
      await rm(worktreeDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/**
 * Fire-and-forget worktree cleanup.
 * @param baseDir - The git repo directory that owns this worktree
 */
export function cleanupWorktree(
  baseDir: string,
  issueId: string,
  worktreePath: string,
): void {
  void removeWorktree(baseDir, worktreePath).catch((error) => {
    logger.warn({ issueId, worktreePath, error }, 'worktree_cleanup_failed')
  })
}
