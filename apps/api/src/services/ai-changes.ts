/**
 * AI-attributed changes: mine `issues_logs_tools_call` for Edit/Write-class
 * tool invocations so we can show "which files did THIS issue's agent touch",
 * independent of git status.
 *
 * Why this exists (the "git diff feels inaccurate" answer):
 *   Git tells you the working-tree delta against HEAD — when multiple issues
 *   share a workspace, that delta includes every other issue's dirt and your
 *   own manual edits. The tool-call log answers a different, sharper question:
 *   "what did the agent (this engine session) write or edit?" — directly from
 *   the agent's own tool input.
 *
 * Coverage:
 *   ✅ Edit / Write / MultiEdit / NotebookEdit (Claude SDK + Claude CLI + Codex
 *      apply_patch when classified as file-edit kind by the per-engine
 *      normalizer)
 *   ❌ Bash-driven edits (sed -i, prettier --write, lockfile updates from
 *      `npm install`, etc.) — those land in `kind='command-run'` and cannot
 *      be reliably attributed without parsing arbitrary shell. Surface via
 *      the git diff fallback panel instead.
 */
import { and, asc, eq } from 'drizzle-orm'
import { isAbsolute, relative, resolve } from 'node:path'
import { db } from '@/db'
import { issueLogs, issuesLogsToolsCall } from '@/db/schema'

/** Tool names we treat as file edits. Stable across Claude SDK/CLI. */
export const FILE_EDIT_TOOLS = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
])

export interface AiTouchedFile {
  /** Path normalized relative to the issue's working directory. */
  path: string
  /** Original absolute or as-reported path (for debugging / display). */
  rawPath: string
  /** Most-recent tool name that touched this file. */
  toolName: string
  /** How many edit calls touched this file across the whole issue. */
  editCount: number
  /** First turn (0-indexed) this file was touched. */
  firstTurnIndex: number
  /** Last turn this file was touched. */
  lastTurnIndex: number
  /** ISO timestamp of the most recent touch. */
  lastTouchAt: string
  /**
   * High-level lifecycle. Conservative — only what we can prove from the
   * tool-call sequence alone (no disk reads here). The route layer can
   * cross-reference git status to upgrade `edited` → `reverted` when the
   * file is clean on disk despite being touched.
   */
  status: 'edited' | 'created' | 'maybe-deleted'
}

interface ToolCallRow {
  toolName: string
  raw: string | null
  turnIndex: number
  entryIndex: number
  timestamp: string | null
  createdAt: Date
}

/**
 * Extract every file edit performed by the agent on this issue, aggregated
 * per file. Edits across multiple turns are merged into one entry per path.
 * Result is sorted by lastTouchAt desc — most recently edited first.
 */
export async function getAiTouchedFiles(
  issueId: string,
  workingDir: string,
): Promise<AiTouchedFile[]> {
  // Join tools-call rows with their parent log entries so we have turn/entry
  // ordering. We filter by `kind='file-edit'` (set by the per-engine
  // normalizer) to avoid having to enumerate every possible toolName.
  const rows: ToolCallRow[] = await db
    .select({
      toolName: issuesLogsToolsCall.toolName,
      raw: issuesLogsToolsCall.raw,
      turnIndex: issueLogs.turnIndex,
      entryIndex: issueLogs.entryIndex,
      timestamp: issueLogs.timestamp,
      createdAt: issuesLogsToolsCall.createdAt,
    })
    .from(issuesLogsToolsCall)
    .innerJoin(issueLogs, eq(issuesLogsToolsCall.logId, issueLogs.id))
    .where(and(
      eq(issuesLogsToolsCall.issueId, issueId),
      eq(issuesLogsToolsCall.kind, 'file-edit'),
      eq(issuesLogsToolsCall.isResult, false),
      eq(issuesLogsToolsCall.isDeleted, 0),
    ))
    .orderBy(asc(issueLogs.turnIndex), asc(issueLogs.entryIndex))

  const byPath = new Map<string, AiTouchedFile>()

  for (const row of rows) {
    const parsed = parseRawInput(row.raw)
    const rawPath = parsed.filePath
    if (!rawPath) continue
    // Normalize to a relative POSIX-ish path so the same file edited via
    // absolute vs relative paths collapses into one entry.
    const normalized = normalizePath(rawPath, workingDir)

    const at = row.timestamp ?? row.createdAt.toISOString()
    const status = deriveStatus(row.toolName, parsed)

    const existing = byPath.get(normalized)
    if (existing) {
      existing.editCount += 1
      existing.toolName = row.toolName
      existing.lastTurnIndex = row.turnIndex
      existing.lastTouchAt = at
      if (status === 'maybe-deleted') {
        existing.status = 'maybe-deleted'
      } else if (existing.status !== 'maybe-deleted' && status === 'created') {
        // A later edit downgrades a "created" to "edited" since the file
        // was modified after creation.
        existing.status = 'edited'
      }
    } else {
      byPath.set(normalized, {
        path: normalized,
        rawPath,
        toolName: row.toolName,
        editCount: 1,
        firstTurnIndex: row.turnIndex,
        lastTurnIndex: row.turnIndex,
        lastTouchAt: at,
        status,
      })
    }
  }

  return Array.from(byPath.values()).sort((a, b) =>
    b.lastTouchAt.localeCompare(a.lastTouchAt),
  )
}

interface ParsedInput {
  filePath?: string
  hasOldString: boolean
  hasNewString: boolean
  contentEmpty: boolean
}

function parseRawInput(raw: string | null): ParsedInput {
  if (!raw) return { hasOldString: false, hasNewString: false, contentEmpty: false }
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const metadata = obj.metadata as Record<string, unknown> | undefined
    const input = (metadata?.input ?? {}) as Record<string, unknown>
    const toolAction = obj.toolAction as Record<string, unknown> | undefined
    const filePath =
      stringOr(input.file_path) ??
      stringOr(input.path) ??
      stringOr(toolAction?.path)
    const oldString = stringOr(input.old_string) ?? stringOr(input.oldText)
    const newString = stringOr(input.new_string) ?? stringOr(input.newText)
    const content = stringOr(input.content)
    return {
      filePath,
      hasOldString: typeof oldString === 'string',
      hasNewString: typeof newString === 'string',
      contentEmpty: content === '',
    }
  } catch {
    return { hasOldString: false, hasNewString: false, contentEmpty: false }
  }
}

function stringOr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function deriveStatus(
  toolName: string,
  parsed: ParsedInput,
): AiTouchedFile['status'] {
  // Write with empty content is a wipe — likely effectively a delete.
  if (toolName === 'Write' && parsed.contentEmpty) return 'maybe-deleted'
  // Write at all = "this is the full new content"; if no old_string ever
  // referenced this file we can call it newly created. Caller can refine
  // by checking the prior occurrences.
  if (toolName === 'Write' && !parsed.hasOldString) return 'created'
  return 'edited'
}

/**
 * Normalize a tool-reported file_path to a path relative to `workingDir`
 * when possible. Falls back to the original string when the path lies
 * outside the working directory (e.g. agent edited an absolute path under
 * /tmp).
 */
function normalizePath(rawPath: string, workingDir: string): string {
  if (!isAbsolute(rawPath)) return rawPath.replace(/^\.\//, '')
  const wd = resolve(workingDir)
  const abs = resolve(rawPath)
  const rel = relative(wd, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) return rawPath
  return rel
}

/** Internal helper for callers that want to know which subset is reverted. */
export function partitionByPresence(
  touched: AiTouchedFile[],
  dirtyPaths: Set<string>,
): { onDisk: AiTouchedFile[], reverted: AiTouchedFile[] } {
  const onDisk: AiTouchedFile[] = []
  const reverted: AiTouchedFile[] = []
  for (const f of touched) {
    if (dirtyPaths.has(f.path)) onDisk.push(f)
    else reverted.push(f)
  }
  return { onDisk, reverted }
}

/** Subset of dirty paths not touched by the agent (Bash / manual / lockfile). */
export function dirtyNotTouched(
  dirtyPaths: string[],
  touched: AiTouchedFile[],
): string[] {
  const touchedSet = new Set(touched.map(t => t.path))
  return dirtyPaths.filter(p => !touchedSet.has(p))
}
