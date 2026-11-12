import { existsSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { inArray } from 'drizzle-orm'
import { db } from '@/db'
import { projects as projectsTable } from '@/db/schema'
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

/**
 * Resolve the main branch start point for worktree creation.
 * Priority: local main > local master > origin/main > origin/master.
 * Throws if no main branch is found — refuses to use HEAD which may
 * point to an arbitrary feature branch with uncommitted state.
 */
async function resolveMainBranch(baseDir: string): Promise<string> {
  const candidates = ['main', 'master', 'origin/main', 'origin/master']
  for (const ref of candidates) {
    const { code } = await runCommand(
      ['git', 'rev-parse', '--verify', '--quiet', ref],
      { cwd: baseDir, stderr: 'pipe' },
    )
    if (code === 0) return ref
  }
  throw new Error(
    `Cannot resolve main branch in ${baseDir}: none of ${candidates.join(', ')} exist`,
  )
}

export async function createWorktree(
  baseDir: string,
  projectId: string,
  issueId: string,
): Promise<string> {
  // Guard: baseDir must be inside a git work tree
  if (!(await isGitRepoFresh(baseDir))) {
    throw new Error(`Cannot create worktree: ${baseDir} is not a git repository`)
  }

  const branchName = `bkd/${issueId}`
  const worktreeDir = resolveWorktreePath(projectId, issueId)
  await mkdir(join(WORKTREE_BASE, projectId), { recursive: true })

  const startPoint = await resolveMainBranch(baseDir)

  // Create worktree with a new branch off the resolved main branch
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

/**
 * Return the issue's worktree, creating it when it does not exist yet.
 *
 * Throws when the worktree cannot be provided. Callers must not fall back to
 * `baseDir`: an issue that asked for isolation would edit the main checkout.
 */
export async function ensureWorktree(
  baseDir: string,
  projectId: string,
  issueId: string,
): Promise<string> {
  const worktreeDir = resolveWorktreePath(projectId, issueId)
  // A directory registered under another repo (the project directory changed)
  // is stale, so the registration is checked against `baseDir`.
  if (existsSync(worktreeDir) && (await isWorktreeRegistered(baseDir, worktreeDir))) {
    return worktreeDir
  }
  return createWorktree(baseDir, projectId, issueId)
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

export interface WorktreeOnDisk {
  projectId: string
  projectDir: string
  issueId: string
  path: string
}

/** Every `<WORKTREE_BASE>/<projectId>/<issueId>` directory on disk. */
export async function listWorktreesOnDisk(): Promise<WorktreeOnDisk[]> {
  const found: WorktreeOnDisk[] = []
  const projectEntries = await readdir(WORKTREE_BASE, { withFileTypes: true }).catch(() => [])
  for (const pe of projectEntries) {
    if (!pe.isDirectory()) continue
    const projectDir = resolve(WORKTREE_BASE, pe.name)
    const issueEntries = await readdir(projectDir, { withFileTypes: true }).catch(() => [])
    for (const ie of issueEntries) {
      if (!ie.isDirectory()) continue
      found.push({ projectId: pe.name, projectDir, issueId: ie.name, path: resolve(projectDir, ie.name) })
    }
  }
  return found
}

/** Map project IDs to their repository directories, soft-deleted projects included. */
async function getProjectRepoDirs(projectIds: string[]): Promise<Map<string, string>> {
  const dirs = new Map<string, string>()
  const BATCH = 500
  for (let i = 0; i < projectIds.length; i += BATCH) {
    const rows = await db
      .select({ id: projectsTable.id, directory: projectsTable.directory })
      .from(projectsTable)
      .where(inArray(projectsTable.id, projectIds.slice(i, i + BATCH)))
    for (const r of rows) {
      if (r.directory) dirs.set(r.id, resolve(r.directory))
    }
  }
  return dirs
}

/** Remove worktrees and any project directory left empty; returns how many went. */
export async function removeWorktrees(
  worktrees: Array<Pick<WorktreeOnDisk, 'projectDir' | 'issueId' | 'path'>>,
  /** Checked right before each removal; false skips that worktree. */
  stillRemovable?: (issueId: string) => boolean,
): Promise<number> {
  let cleaned = 0

  const repoDirs = await getProjectRepoDirs([...new Set(worktrees.map(w => basename(w.projectDir)))])
  const projectDirs = new Set<string>()
  for (const w of worktrees) {
    projectDirs.add(w.projectDir)
    if (stillRemovable && !stillRemovable(w.issueId)) continue
    try {
      // Without a project row there is no repo to deregister from;
      // removeWorktree then falls back to deleting the directory.
      await removeWorktree(repoDirs.get(basename(w.projectDir)) ?? process.cwd(), w.path)
      cleaned++
    } catch {
      await rm(w.path, { recursive: true }).catch(() => {})
      cleaned++
    }
  }

  for (const projectDir of projectDirs) {
    const remaining = await readdir(projectDir).catch(() => ['_'])
    if (remaining.length === 0) {
      await rm(projectDir, { recursive: true }).catch(() => {})
    }
  }

  return cleaned
}
