/**
 * Carry uncommitted work from a parent issue's working directory into a
 * freshly-created child worktree, without modifying the parent's tree.
 * See PLAN-021 fork mode 'snapshot'.
 */
import { cp, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runCommand } from '@/engines/spawn'
import { logger } from '@/logger'

/**
 * Capture tracked changes (staged + unstaged) of `parentWorkingDir` as a
 * detached stash commit. `git stash create` never touches the working tree
 * or any ref. Returns the SHA, or null if there are no tracked changes.
 *
 * Note: `git stash create` does NOT capture untracked files — those are
 * handled separately by copyUntracked().
 */
async function snapshotTracked(parentWorkingDir: string): Promise<string | null> {
  const { code, stdout } = await runCommand(
    ['git', 'stash', 'create'],
    { cwd: parentWorkingDir, stderr: 'pipe' },
  )
  if (code !== 0) return null
  const sha = stdout.trim()
  return sha.length > 0 ? sha : null
}

/** List untracked (and not ignored) files relative to `dir`. */
async function listUntracked(dir: string): Promise<string[]> {
  const { code, stdout } = await runCommand(
    ['git', 'ls-files', '--others', '--exclude-standard'],
    { cwd: dir, stderr: 'pipe' },
  )
  if (code !== 0) return []
  return stdout.split('\n').map(l => l.trim()).filter(Boolean)
}

/**
 * Carry the parent's uncommitted work (tracked changes + untracked files)
 * into a freshly-created child worktree. The parent working tree is left
 * completely untouched. Returns a warning string if the carry was partial
 * (non-fatal — the child issue remains usable), or null on full success.
 */
export async function carryUncommitted(
  parentWorkingDir: string,
  childWorktreeDir: string,
): Promise<string | null> {
  let warning: string | null = null

  // Tracked changes via a detached stash commit. Worktrees of the same repo
  // share the object database, so the SHA is reachable from the child.
  const sha = await snapshotTracked(parentWorkingDir)
  if (sha) {
    const apply = await runCommand(
      ['git', 'stash', 'apply', sha],
      { cwd: childWorktreeDir, stderr: 'pipe' },
    )
    if (apply.code !== 0) {
      logger.warn(
        { childWorktreeDir, sha, stderr: apply.stderr.trim() },
        'fork_carry_tracked_apply_failed',
      )
      warning = 'Some tracked changes could not be applied cleanly; resolve any conflicts manually.'
    }
  }

  // Untracked files copied directly from the parent working directory.
  const untracked = await listUntracked(parentWorkingDir)
  for (const rel of untracked) {
    try {
      const dest = join(childWorktreeDir, rel)
      await mkdir(dirname(dest), { recursive: true })
      await cp(join(parentWorkingDir, rel), dest)
    } catch (err) {
      logger.warn({ childWorktreeDir, rel, err }, 'fork_carry_untracked_copy_failed')
      warning = warning ?? 'Some untracked files could not be copied to the new worktree.'
    }
  }

  return warning
}
