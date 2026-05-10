import type { NormalizedLogEntry, TimelineEntry } from './types'

// ────────────────────────────────────────────────────────────────────────────
// TimelineConverter — single source of truth for NormalizedLogEntry → TimelineEntry.
//
// Both the SSE streaming path (events.ts → toTimelineEntry) and the batch HTTP
// path (logs.ts → toTimeline) go through ONE stateful converter so live and
// refreshed views are byte-for-byte identical.
//
// Key guarantees:
//   - Multi-segment thinking/assistant per turn (split on tool/non-thinking).
//   - chunk merging via startsWith / fallback concat (handles cumulative + delta).
//   - Tool/system/error/user entries pass through with stable ids.
//   - Monotonic per-issue `sequence` for insertion-order rendering on the client.
//   - Noise filtering (short pure-word system messages, ACP boilerplate).
//
// State scope: per-issue Map. The streaming path uses one shared instance;
// the batch path constructs a fresh instance, ingests every entry, and discards it.
// ────────────────────────────────────────────────────────────────────────────

function mapType(entryType: string): TimelineEntry['type'] {
  switch (entryType) {
    case 'thinking': return 'thinking'
    case 'assistant-message': return 'assistant'
    case 'tool-use': return 'tool'
    case 'system-message': return 'system'
    case 'error-message': return 'error'
    case 'user-message': return 'user'
    default: return 'system'
  }
}

function isNoise(entry: NormalizedLogEntry): boolean {
  const trimmed = entry.content.trim()
  if (entry.entryType === 'system-message') {
    if (trimmed.length < 15 && /^[a-z]+$/.test(trimmed)) return true
    if (
      trimmed === 'ACP session loaded' ||
      trimmed === 'ACP session started' ||
      trimmed === 'ACP session initialized'
    ) {
      return true
    }
  }
  return false
}

function buildMetadata(entry: NormalizedLogEntry): NonNullable<TimelineEntry['metadata']> {
  const md = entry.metadata ?? {}
  return {
    streaming: md.streaming as boolean | undefined,
    completed: md.completed as boolean | undefined,
    toolName: (md.toolName ?? entry.toolDetail?.toolName) as string | undefined,
    toolCallId: (md.toolCallId ?? entry.toolDetail?.toolCallId) as string | undefined,
    isResult: entry.toolDetail?.isResult ?? (md.isResult as boolean | undefined),
    exitCode: md.exitCode as number | undefined,
    duration: md.duration as number | undefined,
    input: md.input as unknown,
    path: md.path as string | undefined,
    ...md,
  }
}

interface Buffer {
  content: string
  timestamp: string
  metadata: NonNullable<TimelineEntry['metadata']>
  entryType: string
  /** Stable id assigned at first chunk so subsequent chunks upsert in place */
  id: string
  /** Sequence assigned at first chunk; subsequent chunks reuse it (no re-ordering) */
  sequence: number
}

/**
 * Smart merge for streaming chunks:
 *   - new starts with old → full replacement (cumulative-style streams)
 *   - old starts with new → keep old (out-of-order delivery, drop the shorter)
 *   - otherwise → concatenate (true delta streams)
 */
function mergeChunk(buffer: Buffer, entry: NormalizedLogEntry): void {
  const text = entry.content
  if (text.length > buffer.content.length && text.startsWith(buffer.content)) {
    buffer.content = text
  } else if (buffer.content.length > text.length && buffer.content.startsWith(text)) {
    // keep old
  } else {
    buffer.content += text
  }
  buffer.timestamp = entry.timestamp ?? buffer.timestamp
  if (entry.metadata?.streaming === true) {
    buffer.metadata.streaming = true
  }
  if (entry.metadata?.streaming === false) {
    buffer.metadata.streaming = false
  }
}

interface IssueState {
  currentTurn: number
  thinkingFlushCount: number
  assistantFlushCount: number
  thinkingBuffer: Buffer | null
  assistantBuffer: Buffer | null
  /** Per-ms tiebreaker counter (resets when timestamp moves forward). */
  lastTimestampMs: number
  subSeq: number
}

function newIssueState(): IssueState {
  return {
    currentTurn: -1,
    thinkingFlushCount: 0,
    assistantFlushCount: 0,
    thinkingBuffer: null,
    assistantBuffer: null,
    lastTimestampMs: 0,
    subSeq: 0,
  }
}

/**
 * Compute monotonic sequence number from entry timestamp.
 *
 * Formula: `timestamp_ms * 1000 + tiebreaker` — gives a single number that's
 * stable across:
 *   - Server restarts (live converter no longer starts from 0 and collides
 *     with old batch-converted entries that were sequenced 0..N)
 *   - Streaming vs batch paths (both compute the same value for the same
 *     timestamp, so refresh and live views agree)
 *   - Frontend optimistic adds (caller can compute `Date.now() * 1000`
 *     to position a pending entry at the bottom of the timeline)
 *
 * The tiebreaker (subSeq) handles the rare case of entries arriving within
 * the same millisecond — it keeps strict insertion order within that ms.
 */
function nextSequence(state: IssueState, entry: NormalizedLogEntry): number {
  const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
  if (ts > state.lastTimestampMs) {
    state.lastTimestampMs = ts
    state.subSeq = 0
  } else {
    state.subSeq++
  }
  return ts * 1000 + state.subSeq
}

function bufferToEntry(
  buffer: Buffer,
  type: TimelineEntry['type'],
  opts?: { closing?: boolean },
): TimelineEntry {
  // When closing the buffer (segment ended, turn flushed, settle reached),
  // force `streaming: false` on the emitted entry. Without this, an engine
  // killed mid-stream leaves the buffer's streaming flag stuck at true —
  // the frontend then renders that entry as a live streaming block forever
  // (full content, no collapse) whenever ANY later turn is running.
  const metadata = opts?.closing
    ? { ...buffer.metadata, streaming: false as boolean | undefined }
    : buffer.metadata
  return {
    id: buffer.id,
    turnIndex: parseTurnFromId(buffer.id),
    type,
    entryType: buffer.entryType,
    content: buffer.content,
    timestamp: buffer.timestamp,
    sequence: buffer.sequence,
    metadata,
  }
}

function parseTurnFromId(id: string): number {
  // id format: turn-{n}-{type}[-suffix]
  const m = /^turn-(\d+)-/.exec(id)
  return m ? Number(m[1]) : 0
}

export class TimelineConverter {
  private issues = new Map<string, IssueState>()

  private getState(issueId: string): IssueState {
    let s = this.issues.get(issueId)
    if (!s) {
      s = newIssueState()
      this.issues.set(issueId, s)
    }
    return s
  }

  reset(issueId: string): void {
    this.issues.delete(issueId)
  }

  /**
   * Ingest one NormalizedLogEntry. Returns 0..N TimelineEntry to upsert
   * by id on the client. Each returned entry is either:
   *   - a streaming buffer snapshot (thinking/assistant) with the SAME id
   *     across chunks → frontend overwrites in place
   *   - a flushed segment closing entry (when a new segment opens)
   *   - a tool/system/error/user passthrough with stable id
   */
  ingest(issueId: string, entry: NormalizedLogEntry): TimelineEntry[] {
    if (isNoise(entry)) return []

    const state = this.getState(issueId)
    const type = mapType(entry.entryType)
    const turn = entry.turnIndex ?? 0
    const out: TimelineEntry[] = []

    // Turn boundary: flush both buffers (final state) before continuing.
    if (turn !== state.currentTurn && state.currentTurn >= 0) {
      if (state.thinkingBuffer) {
        out.push(bufferToEntry(state.thinkingBuffer, 'thinking', { closing: true }))
        state.thinkingBuffer = null
      }
      if (state.assistantBuffer) {
        out.push(bufferToEntry(state.assistantBuffer, 'assistant', { closing: true }))
        state.assistantBuffer = null
      }
      state.thinkingFlushCount = 0
      state.assistantFlushCount = 0
    }
    state.currentTurn = turn

    if (type === 'thinking') {
      // Thinking after assistant in same turn → close assistant segment first,
      // bump assistantFlushCount so the NEXT assistant chunk opens a new segment.
      if (state.assistantBuffer) {
        out.push(bufferToEntry(state.assistantBuffer, 'assistant', { closing: true }))
        state.assistantBuffer = null
        state.assistantFlushCount++
      }
      if (!state.thinkingBuffer) {
        const suffix = state.thinkingFlushCount === 0 ? '' : `-${state.thinkingFlushCount}`
        state.thinkingBuffer = {
          content: entry.content,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          metadata: buildMetadata(entry),
          entryType: entry.entryType,
          id: `turn-${turn}-thinking${suffix}`,
          sequence: nextSequence(state, entry),
        }
      } else {
        mergeChunk(state.thinkingBuffer, entry)
      }
      out.push(bufferToEntry(state.thinkingBuffer, 'thinking'))
      return out
    }

    if (type === 'assistant') {
      // Assistant after thinking → close thinking segment, bump count.
      if (state.thinkingBuffer) {
        out.push(bufferToEntry(state.thinkingBuffer, 'thinking', { closing: true }))
        state.thinkingBuffer = null
        state.thinkingFlushCount++
      }
      if (!state.assistantBuffer) {
        const suffix = state.assistantFlushCount === 0 ? '' : `-${state.assistantFlushCount}`
        state.assistantBuffer = {
          content: entry.content,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          metadata: buildMetadata(entry),
          entryType: entry.entryType,
          id: `turn-${turn}-assistant${suffix}`,
          sequence: nextSequence(state, entry),
        }
      } else {
        mergeChunk(state.assistantBuffer, entry)
      }
      out.push(bufferToEntry(state.assistantBuffer, 'assistant'))
      return out
    }

    // tool / system / error / user — passthrough with stable id.
    // Both buffers close because a non-thinking/non-assistant entry interrupts
    // the segment. Bump counters so the next chunk of the same type opens a
    // fresh segment with a new id (this is what enables Cursor-style inline
    // rendering: 思考 → 工具 → 再思考 → 工具 → 回答).
    if (state.thinkingBuffer) {
      out.push(bufferToEntry(state.thinkingBuffer, 'thinking', { closing: true }))
      state.thinkingBuffer = null
      state.thinkingFlushCount++
    }
    if (state.assistantBuffer) {
      out.push(bufferToEntry(state.assistantBuffer, 'assistant', { closing: true }))
      state.assistantBuffer = null
      state.assistantFlushCount++
    }

    const seq = nextSequence(state, entry)
    const idSuffix = entry.messageId ?? entry.timestamp ?? `seq-${seq}`
    out.push({
      id: `turn-${turn}-${type}-${idSuffix}`,
      turnIndex: turn,
      type,
      entryType: entry.entryType,
      content: entry.content,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      sequence: seq,
      metadata: buildMetadata(entry),
    })
    return out
  }

  /**
   * Flush any pending thinking/assistant buffers as final entries.
   * Called when an issue settles (turn ends, run completes) — without this,
   * the last in-flight segment never gets a "final" snapshot pushed to clients.
   */
  flush(issueId: string): TimelineEntry[] {
    const state = this.issues.get(issueId)
    if (!state) return []
    const out: TimelineEntry[] = []
    if (state.thinkingBuffer) {
      out.push(bufferToEntry(state.thinkingBuffer, 'thinking', { closing: true }))
      state.thinkingBuffer = null
      state.thinkingFlushCount++
    }
    if (state.assistantBuffer) {
      out.push(bufferToEntry(state.assistantBuffer, 'assistant', { closing: true }))
      state.assistantBuffer = null
      state.assistantFlushCount++
    }
    return out
  }
}

// Singleton for the live SSE pipeline. Issue state cleared on settle (see issue/lifecycle/settle.ts).
export const liveConverter = new TimelineConverter()

/**
 * Convert a single entry for SSE streaming.
 *
 * Note: this returns a SINGLE entry (latest snapshot for that id). In the
 * streaming path each NormalizedLogEntry maps to exactly one SSE write, so
 * we collapse multi-emit cases (segment-flush + new-segment) into the LAST
 * entry of the ingest output. Callers that need every interim flush should
 * use `liveConverter.ingest()` directly.
 */
export function toTimelineEntry(entry: NormalizedLogEntry): TimelineEntry {
  // Issue id is unknown here (legacy single-arg signature). Use a global
  // bucket so segment counters at least monotonic-rise within the process.
  // The new path (events.ts) uses liveConverter.ingest with the real issueId.
  const out = liveConverter.ingest('__legacy__', entry)
  return out.at(-1) ?? {
    id: `turn-${entry.turnIndex ?? 0}-${mapType(entry.entryType)}`,
    turnIndex: entry.turnIndex ?? 0,
    type: mapType(entry.entryType),
    entryType: entry.entryType,
    content: entry.content,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    sequence: 0,
    metadata: buildMetadata(entry),
  }
}

/**
 * Batch conversion for the HTTP `/logs` endpoint. Creates a fresh converter,
 * ingests in chronological order, and flushes any tail buffers — guaranteeing
 * the result is identical to what the client accumulated via SSE.
 */
export function toTimeline(entries: NormalizedLogEntry[]): TimelineEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const ta = a.turnIndex ?? 0
    const tb = b.turnIndex ?? 0
    if (ta !== tb) return ta - tb
    const tsa = a.timestamp ? new Date(a.timestamp).getTime() : 0
    const tsb = b.timestamp ? new Date(b.timestamp).getTime() : 0
    return tsa - tsb
  })

  const conv = new TimelineConverter()
  const out: TimelineEntry[] = []
  // Track the latest snapshot per id so multi-emit ingest results collapse to
  // one entry per id (matches what the client sees after SSE upserts).
  const byId = new Map<string, TimelineEntry>()

  for (const entry of sorted) {
    const produced = conv.ingest('batch', entry)
    for (const p of produced) byId.set(p.id, p)
  }
  for (const tail of conv.flush('batch')) byId.set(tail.id, tail)

  // Re-emit in sequence order to preserve insertion order even after upserts.
  for (const e of byId.values()) out.push(e)
  out.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  return out
}
