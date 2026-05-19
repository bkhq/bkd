/**
 * AI-attributed per-file timeline + net-effect reconstruction.
 *
 * Companion to ./ai-changes — that one returns "which files did the agent
 * touch" (high level). This one answers, for ONE file: "what did the agent
 * do to it, turn by turn, and what's the net effect vs the original?"
 *
 * Reconstruction strategy (no disk reads):
 *   1. Sort all Edit/Write/MultiEdit calls on this file by (turnIndex, entryIndex).
 *   2. Find the "original" content:
 *      - First call is Edit/MultiEdit → its `old_string` IS the pre-issue file
 *        content (or for MultiEdit, the first sub-edit's old_string is the
 *        relevant slice). Caveat: Edit calls only carry the slice they touched,
 *        not the whole file — so this is the "starting state of the touched
 *        region", not the whole file. We mark this case `baselineSource='edit'`
 *        so callers can disclose the limitation.
 *      - First call is Write → no usable baseline (the previous content is
 *        gone). `baselineSource='none'`. Net effect is "<existed before> →
 *        <last Write's content>".
 *   3. Replay each operation onto a virtual buffer:
 *      - Edit: substring replace old_string → new_string (first occurrence;
 *        matches Claude's Edit semantics).
 *      - MultiEdit: apply each [old,new] pair sequentially.
 *      - Write: clobber buffer with the new content.
 *   4. The final buffer is the net effect. Diff against the initial buffer
 *      gives the unified-diff equivalent of `git diff baseline...current`
 *      restricted to "what the agent thinks the file is".
 */
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { issueLogs, issuesLogsToolsCall } from '@/db/schema'

export interface FileTimelineEdit {
  /** Sequence in the conversation (turnIndex, entryIndex) for sorting. */
  turnIndex: number
  entryIndex: number
  /** ISO timestamp of the tool call. */
  at: string
  /** Tool name (Edit/Write/MultiEdit/NotebookEdit). */
  toolName: string
  /** Counts after applying THIS edit to the running buffer. */
  bufferLinesAfter: number
  /** Lines added by this single edit vs the buffer state immediately before. */
  additions: number
  /** Lines removed by this single edit vs the buffer state immediately before. */
  deletions: number
  /**
   * If true, the operation could not be replayed cleanly (e.g. Edit's
   * old_string not present in current buffer — Claude's tool would have
   * failed too). We still surface the call but with bufferLinesAfter set
   * to the pre-state.
   */
  skipped: boolean
  /**
   * Optional human-readable description of the kind of change for one-line
   * timeline rows, e.g. "Edit: 1 hunk", "Write: full file (45 lines)".
   */
  summary: string
}

export interface FileTimeline {
  path: string
  baselineSource: 'edit' | 'write' | 'none'
  baseline: string
  finalBuffer: string
  /** Additions / deletions of finalBuffer vs baseline. */
  netAdditions: number
  netDeletions: number
  edits: FileTimelineEdit[]
  /**
   * `reverted`: at least one edit was applied but final buffer === baseline.
   * `write-only`: first op was Write → no usable baseline reconstruction.
   * `clean`: final differs from baseline.
   */
  status: 'reverted' | 'write-only' | 'clean'
}

interface RawRow {
  toolName: string
  raw: string | null
  turnIndex: number
  entryIndex: number
  timestamp: string | null
  createdAt: Date
}

interface ParsedCall {
  filePath?: string
  oldString?: string
  newString?: string
  content?: string
  /** MultiEdit sub-edits (when present). */
  edits?: Array<{ oldString: string, newString: string }>
}

function parseCall(raw: string | null): ParsedCall {
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const metadata = obj.metadata as Record<string, unknown> | undefined
    const input = (metadata?.input ?? {}) as Record<string, unknown>
    const editsRaw = Array.isArray(input.edits) ? input.edits : null
    const edits = editsRaw
      ? editsRaw
          .map((e) => {
            if (typeof e !== 'object' || e === null) return null
            const o = e as Record<string, unknown>
            const oldString = typeof o.old_string === 'string' ? o.old_string : null
            const newString = typeof o.new_string === 'string' ? o.new_string : null
            if (oldString === null || newString === null) return null
            return { oldString, newString }
          })
          .filter((e): e is { oldString: string, newString: string } => e !== null)
      : undefined
    return {
      filePath:
        typeof input.file_path === 'string' ? input.file_path :
          typeof input.path === 'string' ? input.path :
            undefined,
      oldString: typeof input.old_string === 'string' ? input.old_string : undefined,
      newString: typeof input.new_string === 'string' ? input.new_string : undefined,
      content: typeof input.content === 'string' ? input.content : undefined,
      edits,
    }
  } catch {
    return {}
  }
}

function countLines(s: string): number {
  if (!s) return 0
  const trimmed = s.endsWith('\n') ? s.slice(0, -1) : s
  return trimmed ? trimmed.split('\n').length : 0
}

function diffLineCounts(before: string, after: string): { additions: number, deletions: number } {
  // Coarse but stable: count line difference. For the timeline UI we just
  // need a "how much did this turn change" magnitude, not a precise hunk.
  const a = countLines(before)
  const b = countLines(after)
  if (b >= a) return { additions: b - a, deletions: 0 }
  return { additions: 0, deletions: a - b }
}

/**
 * Reconstruct the per-file timeline by replaying tool calls. Returns null
 * when no Edit/Write calls touched this file.
 */
export async function getFileTimeline(
  issueId: string,
  filePath: string,
): Promise<FileTimeline | null> {
  const rows: RawRow[] = await db
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

  // Filter to the requested path. Comparison must accept absolute, relative,
  // and ./-prefixed forms — accept either an exact match or any path whose
  // suffix equals the requested one.
  const wanted = filePath.replace(/^\.\//, '')
  const relevant = rows.filter((row) => {
    const p = parseCall(row.raw).filePath
    if (!p) return false
    const stripped = p.replace(/^\.\//, '')
    return stripped === wanted || stripped.endsWith(`/${wanted}`) || wanted.endsWith(`/${stripped}`)
  })

  if (relevant.length === 0) return null

  // Build the baseline from the first call.
  let baseline = ''
  let baselineSource: FileTimeline['baselineSource'] = 'none'
  const first = relevant[0]
  const firstParsed = parseCall(first.raw)
  if (first.toolName === 'Edit' && firstParsed.oldString !== undefined) {
    baseline = firstParsed.oldString
    baselineSource = 'edit'
  } else if (first.toolName === 'MultiEdit' && firstParsed.edits && firstParsed.edits.length > 0) {
    baseline = firstParsed.edits[0].oldString
    baselineSource = 'edit'
  } else if (first.toolName === 'Write') {
    baseline = ''
    baselineSource = 'write'
  }

  let buffer = baseline
  const edits: FileTimelineEdit[] = []

  for (const row of relevant) {
    const parsed = parseCall(row.raw)
    const before = buffer
    let summary = row.toolName
    let skipped = false

    if (row.toolName === 'Edit' && parsed.oldString !== undefined && parsed.newString !== undefined) {
      if (buffer.includes(parsed.oldString)) {
        buffer = buffer.replace(parsed.oldString, parsed.newString)
        summary = `Edit: 1 hunk`
      } else {
        skipped = true
        summary = `Edit: skipped (anchor not found)`
      }
    } else if (row.toolName === 'MultiEdit' && parsed.edits && parsed.edits.length > 0) {
      let appliedHunks = 0
      for (const e of parsed.edits) {
        if (buffer.includes(e.oldString)) {
          buffer = buffer.replace(e.oldString, e.newString)
          appliedHunks += 1
        }
      }
      summary = `MultiEdit: ${appliedHunks}/${parsed.edits.length} hunks`
      if (appliedHunks === 0) skipped = true
    } else if (row.toolName === 'Write' && parsed.content !== undefined) {
      buffer = parsed.content
      summary = parsed.content === ''
        ? 'Write: emptied'
        : `Write: full file (${countLines(parsed.content)} lines)`
    } else if (row.toolName === 'NotebookEdit') {
      // Best effort — Notebook edits carry cell-level changes; we surface the
      // call without replaying. Buffer is unchanged.
      summary = 'NotebookEdit'
      skipped = true
    } else {
      skipped = true
      summary = `${row.toolName}: unrecognised payload`
    }

    const { additions, deletions } = diffLineCounts(before, buffer)
    edits.push({
      turnIndex: row.turnIndex,
      entryIndex: row.entryIndex,
      at: row.timestamp ?? row.createdAt.toISOString(),
      toolName: row.toolName,
      bufferLinesAfter: countLines(buffer),
      additions,
      deletions,
      skipped,
      summary,
    })
  }

  const { additions: netAdditions, deletions: netDeletions } = diffLineCounts(baseline, buffer)
  const status: FileTimeline['status'] =
    baselineSource === 'write' ? 'write-only' :
      buffer === baseline ? 'reverted' :
        'clean'

  return {
    path: wanted,
    baselineSource,
    baseline,
    finalBuffer: buffer,
    netAdditions,
    netDeletions,
    edits,
    status,
  }
}
