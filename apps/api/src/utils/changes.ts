import { lstat, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { resolveWorktreePath } from '@/engines/issue/utils/worktree'
import { runCommand } from '@/engines/spawn'

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

export type ChangeType = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unknown'

export interface GitChangedFile {
  path: string
  status: string
  type: ChangeType
  staged: boolean
  unstaged: boolean
  previousPath?: string
  additions?: number
  deletions?: number
  /** true when the file exceeds the large-file threshold (20 MB) */
  oversized?: boolean
  /** human-readable file size (only set when oversized) */
  sizeDisplay?: string
}

export function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number, stdout: string, timedOut?: boolean }> {
  return runCommand(['git', ...args], { cwd, timeout: 15_000 })
}

function parseStatusEntry(entry: string, previousPath?: string): GitChangedFile | null {
  if (entry.length < 4) return null
  const x = entry[0]
  const y = entry[1]
  const status = `${x}${y}`
  const path = entry.slice(3)

  let type: ChangeType = 'unknown'
  if (status === '??') type = 'untracked'
  else if (x === 'R' || y === 'R') type = 'renamed'
  else if (x === 'A' || y === 'A') type = 'added'
  else if (x === 'D' || y === 'D') type = 'deleted'
  else if (x === 'M' || y === 'M') type = 'modified'

  const staged = x !== ' ' && x !== '?'
  const unstaged = y !== ' ' && y !== '?'
  return { path, status, type, staged, unstaged, previousPath }
}

/** Changed files of a work tree (staged, unstaged and untracked), oversized ones flagged. */
export async function listChangedFiles(cwd: string): Promise<{ files: GitChangedFile[], timedOut?: boolean }> {
  // -z: paths verbatim, entries "XY path\0", renames and copies "XY to\0from\0"
  const result = await runGit(['status', '--porcelain=v1', '-z', '-uall'], cwd)
  if (result.timedOut) return { files: [], timedOut: true }
  if (result.code !== 0) return { files: [] }
  const entries = result.stdout.split('\0')
  const parsed: GitChangedFile[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    const hasSource = entry[0] === 'R' || entry[0] === 'C'
    const file = parseStatusEntry(entry, hasSource ? entries[++i] : undefined)
    if (file) parsed.push(file)
  }
  parsed.sort((a, b) => a.path.localeCompare(b.path))

  const sizeFlags = await Promise.all(parsed.map(file => checkOversized(cwd, file.path)))
  return { files: parsed.map((file, i) => sizeFlags[i] ? { ...file, ...sizeFlags[i] } : file) }
}

/**
 * Line counts per path from one diff against HEAD, which covers staged and
 * unstaged changes without double-counting partially staged hunks.
 * Records are "add\tdel\tpath\0", renames "add\tdel\t\0from\0to\0"; binaries count "-".
 */
async function diffLineCounts(cwd: string): Promise<Map<string, { additions: number, deletions: number }>> {
  const counts = new Map<string, { additions: number, deletions: number }>()
  const { code, stdout } = await runGit(['diff', 'HEAD', '-M', '--numstat', '-z', '--no-color', '--no-ext-diff'], cwd)
  if (code !== 0) return counts
  const records = stdout.split('\0')
  for (let i = 0; i < records.length; i++) {
    const [add, del, path] = records[i]!.split('\t')
    if (add === undefined || del === undefined) continue
    const to = path || (i += 2, records[i])
    if (!to) continue
    counts.set(to, {
      additions: Number.isNaN(Number(add)) ? 0 : Number(add),
      deletions: Number.isNaN(Number(del)) ? 0 : Number(del),
    })
  }
  return counts
}

async function untrackedLineCount(cwd: string, path: string): Promise<number> {
  if (!isPathInsideRoot(cwd, path)) return 0
  try {
    return countTextLines(await Bun.file(resolve(cwd, path)).text())
  } catch {
    return 0
  }
}

/** Changed files of a work tree with their line counts, and the totals. Oversized files count as zero. */
export async function collectChanges(cwd: string): Promise<{
  files: GitChangedFile[]
  additions: number
  deletions: number
  timedOut?: boolean
}> {
  const { files, timedOut } = await listChangedFiles(cwd)
  if (timedOut) return { files: [], additions: 0, deletions: 0, timedOut: true }
  if (files.length === 0) return { files, additions: 0, deletions: 0 }

  const counts = await diffLineCounts(cwd)
  const withStats = await Promise.all(files.map(async (file) => {
    if (file.oversized) return { ...file, additions: 0, deletions: 0 }
    if (file.type === 'untracked') {
      return { ...file, additions: await untrackedLineCount(cwd, file.path), deletions: 0 }
    }
    return { ...file, ...(counts.get(file.path) ?? { additions: 0, deletions: 0 }) }
  }))
  return {
    files: withStats,
    additions: withStats.reduce((sum, f) => sum + f.additions, 0),
    deletions: withStats.reduce((sum, f) => sum + f.deletions, 0),
  }
}
