import { mkdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { WORKTREE_DIR } from '@/engines/issue/constants'
import { runCommand } from '@/engines/spawn'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'
import { isGitRepoFresh } from '@/utils/git'

/** Resolve WORKTREE_DIR — absolute paths used as-is, relative resolved from ROOT_DIR */
export const WORKTREE_BASE = WORKTREE_DIR.startsWith('/') ?
  WORKTREE_DIR :
    join(ROOT_DIR, WORKTREE_DIR)

/** Safe root for rm fallback — never delete outside this directory */
const WORKTREE_SAFE_ROOT = WORKTREE_BASE

// ---------- Git worktree helpers ----------

/**
 * Deterministic worktree path: `<WORKTREE_BASE>/<projectId>/<issueId>/`
 */
export function resolveWorktreePath(projectId: string, issueId: string): string {
  return join(WORKTREE_BASE, projectId, issueId)
}

/** Return the ref name if it resolves to a commit in `baseDir`, else null. */
async function verifyRef(baseDir: string, ref: string): Promise<string | null> {
  const { code } = await runCommand(
    ['git', 'rev-parse', '--verify', '--quiet', ref],
    { cwd: baseDir, stderr: 'pipe' },
  )
  return code === 0 ? ref : null
}

/**
 * Resolve the start-point ref for worktree creation.
 *
 * Priority:
 *  1. The repo's actual default branch via `origin/HEAD` (handles repos
 *     using `release`/`develop`/etc. instead of `main`/`master`).
 *  2. Common default-branch names.
 *  3. Current `HEAD` as a last resort — a worktree branched off HEAD is
 *     still isolated from the main checkout, which is far safer than
 *     falling back to running directly in the shared repo directory.
 *
 * Throws only when even `HEAD` cannot be resolved (e.g. an empty repo).
 */
async function resolveStartPoint(baseDir: string): Promise<string> {
  // 1. Repo's declared default branch (origin/HEAD -> refs/remotes/origin/<x>).
  const { code, stdout } = await runCommand(
    ['git', 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'],
    { cwd: baseDir, stderr: 'pipe' },
  )
  if (code === 0) {
    const defaultRef = stdout.trim().replace(/^refs\/remotes\//, '')
    if (defaultRef && (await verifyRef(baseDir, defaultRef))) return defaultRef
  }

  // 2. Common default-branch names.
  const candidates = [
    'origin/main',
    'origin/master',
    'origin/release',
    'origin/develop',
    'main',
    'master',
    'release',
    'develop',
  ]
  for (const ref of candidates) {
    if (await verifyRef(baseDir, ref)) return ref
  }

  // 3. Last resort — current HEAD (still isolated as a separate worktree).
  if (await verifyRef(baseDir, 'HEAD')) {
    logger.warn({ baseDir }, 'worktree_start_point_fallback_head')
    return 'HEAD'
  }

  throw new Error(`Cannot resolve a worktree start point in ${baseDir}`)
}

export async function createWorktree(
  baseDir: string,
  projectId: string,
  issueId: string,
  /**
   * Optional git ref to branch the worktree from. Defaults to the resolved
   * default-branch start point. Used by forked dependent issues to start
   * from the parent issue's branch (PLAN-021).
   */
  startPointRef?: string,
): Promise<string> {
  // Guard: baseDir must be inside a git work tree
  if (!(await isGitRepoFresh(baseDir))) {
    throw new Error(`Cannot create worktree: ${baseDir} is not a git repository`)
  }

  const branchName = `bkd/${issueId}`
  const worktreeDir = resolveWorktreePath(projectId, issueId)
  await mkdir(join(WORKTREE_BASE, projectId), { recursive: true })

  // If the worktree dir already exists and is registered, reuse it as-is —
  // makes createWorktree idempotent (a forked issue may pre-create it).
  if (await isWorktreeRegistered(baseDir, worktreeDir)) {
    logger.debug({ issueId, worktreeDir }, 'worktree_reuse_existing')
    return worktreeDir
  }

  let startPoint = startPointRef
  if (startPoint) {
    const { code } = await runCommand(
      ['git', 'rev-parse', '--verify', '--quiet', startPoint],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (code !== 0) startPoint = undefined
  }
  if (!startPoint) startPoint = await resolveStartPoint(baseDir)

  // Create worktree with a new branch off the resolved start point
  const result = await runCommand(
    ['git', 'worktree', 'add', '-b', branchName, worktreeDir, startPoint],
    { cwd: baseDir, stderr: 'pipe' },
  )
  if (result.code !== 0) {
    // Branch may already exist from a previous run — try without -b
    const retry = await runCommand(
      ['git', 'worktree', 'add', worktreeDir, branchName],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (retry.code !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr.trim()} / ${retry.stderr.trim()}`)
    }
  }
  logger.debug({ issueId, worktreeDir, branchName, startPoint }, 'worktree_created')
  return worktreeDir
}

export async function removeWorktree(baseDir: string, worktreeDir: string): Promise<void> {
  const resolved = resolve(worktreeDir)
  try {
    const { code } = await runCommand(
      ['git', 'worktree', 'remove', '--force', resolved],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (code !== 0) {
      throw new Error(`git worktree remove exited with code ${code}`)
    }
    logger.debug({ worktreeDir: resolved }, 'worktree_removed')
  } catch (error) {
    logger.warn({ worktreeDir: resolved, error }, 'worktree_remove_failed')
    // Containment guard: never rm outside the managed worktree directory
    if (!resolved.startsWith(WORKTREE_SAFE_ROOT + sep)) {
      logger.error(
        { worktreeDir: resolved, safeRoot: WORKTREE_SAFE_ROOT },
        'worktree_remove_path_escape_rejected',
      )
      return
    }
    // Fallback: just delete the directory
    try {
      await rm(resolved, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/**
 * Verify that a worktree directory is registered under the given git repo.
 * Returns `true` if `git worktree list` from `baseDir` includes `worktreeDir`.
 */
export async function isWorktreeRegistered(baseDir: string, worktreeDir: string): Promise<boolean> {
  try {
    const { code, stdout: output } = await runCommand(
      ['git', 'worktree', 'list', '--porcelain'],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (code !== 0) return false
    // Each worktree block starts with "worktree <absolute-path>"
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ') && line.slice(9) === worktreeDir) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Fire-and-forget worktree cleanup.
 * @param baseDir - The git repo directory that owns this worktree
 */
export function cleanupWorktree(baseDir: string, issueId: string, worktreePath: string): void {
  void removeWorktree(baseDir, worktreePath).catch((error) => {
    logger.warn({ issueId, worktreePath, error }, 'worktree_cleanup_failed')
  })
}
