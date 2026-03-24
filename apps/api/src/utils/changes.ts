import { lstat, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { resolveWorktreePath } from '@/engines/issue/utils/worktree'

/** Files larger than this threshold are flagged as oversized and skipped for diff */
export const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024 // 20 MB

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * Check file size using lstat (does not follow symlinks).
 * Returns `{ oversized, sizeDisplay }` when the file exceeds the threshold.
 */
export async function checkOversized(
  root: string,
  relPath: string,
): Promise<{ oversized: true, sizeDisplay: string } | null> {
  if (!isPathInsideRoot(root, relPath)) return null
  try {
    const s = await lstat(resolve(root, relPath))
    if (s.isFile() && s.size > LARGE_FILE_THRESHOLD) {
      return { oversized: true, sizeDisplay: formatFileSize(s.size) }
    }
  } catch {
    // file may have been deleted — that's fine
  }
  return null
}

/**
 * Returns true when `path` (relative to `root`) resolves inside the `root` directory.
 * Prevents path-traversal reads outside the git working tree.
 */
export function isPathInsideRoot(root: string, path: string): boolean {
  const abs = resolve(root, path)
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  return abs === root || abs.startsWith(rootPrefix)
}

/**
 * Count non-empty lines in a text string, normalising CRLF.
 */
export function countTextLines(content: string): number {
  if (!content) return 0
  const normalized = content.replace(/\r\n/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed ? trimmed.split('\n').length : 0
}

/**
 * Resolve the correct working directory for an issue, respecting worktrees.
 * Falls back to `projectRoot` when the worktree directory doesn't exist.
 */
export async function resolveIssueDir(
  projectId: string,
  issueId: string,
  useWorktree: boolean,
  projectRoot: string,
): Promise<string> {
  if (!useWorktree) return projectRoot
  const wtPath = resolveWorktreePath(projectId, issueId)
  try {
    const s = await stat(wtPath)
    if (s.isDirectory()) return wtPath
  } catch {
    // worktree dir doesn't exist — fall back
  }
  return projectRoot
}
