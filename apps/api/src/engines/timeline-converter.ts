import type { NormalizedLogEntry, TimelineEntry } from './types'

// ────────────────────────────────────────────────────────────────────────────
// TimelineConverter — single source of truth for NormalizedLogEntry → TimelineEntry.
//
// Both the SSE streaming path (timeline-emit.ts → liveConverter.ingest) and
// the batch HTTP path (logs.ts → toTimeline) go through ONE stateful converter
// so live and refreshed views are byte-for-byte identical, including the
// `sequence` field used for client-side sort.
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
  /**
   * Original NormalizedLogEntry.messageId. Preserved on output so the client
   * can dedupe optimistic entries (which carry the raw messageId) against
   * canonical entries (which have id=`turn-N-{type}-{messageId}` and would
   * otherwise look unrelated). Without this field, sending an attachment
   * shows the user-message twice — optimistic with broken-image URL plus
   * canonical with proper image — until refresh.
   */
  messageId?: string
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
    // keep old — out-of-order delivery with shorter content, drop
  } else if (text === buffer.content) {
    // identical — avoid doubling the content when the engine re-emits the
    // same cumulative chunk without new text
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
  /**
   * The last sequence number issued for this issue. Sequences are strictly
   * monotonic — every call to `nextSequence` returns a value greater than
   * `lastSeq`, regardless of timestamp ordering.
   */
  lastSeq: number
}

function newIssueState(): IssueState {
  return {
    currentTurn: -1,
    thinkingFlushCount: 0,
    assistantFlushCount: 0,
    thinkingBuffer: null,
    assistantBuffer: null,
    lastSeq: 0,
  }
}

/**
 * Compute a strictly-monotonic sequence number anchored to the entry timestamp.
 *
 * Formula: `max(timestamp_ms * 1000, lastSeq + 1)` — guarantees:
 *   - Strict monotonicity inside an issue, even when entries arrive with
 *     out-of-order or backward timestamps (some engines emit chunks whose
 *     `timestamp` lags wall-clock by a few ms; the previous formula could
 *     emit a smaller sequence than its predecessor in that case).
 *   - Determinism across paths: same input → same sequence regardless of
 *     which TimelineConverter instance processed it. The live SSE singleton
 *     and the per-request batch converter (in `toTimeline`) now agree
 *     byte-for-byte, so frontend re-sorts on `/logs` refresh do not jitter
 *     the rendered order.
 *   - Optimistic adds on the frontend can still use `Date.now() * 1000` —
 *     when the canonical entry replaces it, the canonical sequence is at
 *     least as large (later wall-clock) and ordering is preserved.
 */
function nextSequence(state: IssueState, entry: NormalizedLogEntry): number {
  const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
  const next = Math.max(ts * 1000, state.lastSeq + 1)
  state.lastSeq = next
  return next
}

/**
 * Zero-padded segment suffix for thinking/assistant buffer ids.
 *
 * Why: segment ids feed into `compareTimeline`'s id-based tiebreaker. With
 * a bare numeric suffix, lexicographic comparison ranks `thinking-10` before
 * `thinking-2`. Padding to four digits keeps lexicographic == numerical for
 * any turn with up to 9999 segments — effectively unbounded for real
 * conversations.
 */
function segmentSuffix(count: number): string {
  return count.toString().padStart(4, '0')
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
    messageId: buffer.messageId,
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
      // Drop empty thinking chunks — some engines (Claude via ACP) emit
      // agent_thought_chunk entries with no content. Without this filter
      // they create empty thinking segments that clutter the timeline.
      if (!entry.content.trim()) return []

      // Thinking after assistant in same turn → close assistant segment first,
      // bump assistantFlushCount so the NEXT assistant chunk opens a new segment.
      if (state.assistantBuffer) {
        out.push(bufferToEntry(state.assistantBuffer, 'assistant', { closing: true }))
        state.assistantBuffer = null
        state.assistantFlushCount++
      }
      if (!state.thinkingBuffer) {
        state.thinkingBuffer = {
          content: entry.content,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          metadata: buildMetadata(entry),
          entryType: entry.entryType,
          id: `turn-${turn}-thinking-${segmentSuffix(state.thinkingFlushCount)}`,
          sequence: nextSequence(state, entry),
          messageId: entry.messageId,
        }
      } else {
        mergeChunk(state.thinkingBuffer, entry)
        // Adopt the chunk's messageId if the buffer didn't have one yet
        // (engines that only set messageId on the final non-streaming chunk).
        if (!state.thinkingBuffer.messageId && entry.messageId) {
          state.thinkingBuffer.messageId = entry.messageId
        }
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
        state.assistantBuffer = {
          content: entry.content,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          metadata: buildMetadata(entry),
          entryType: entry.entryType,
          id: `turn-${turn}-assistant-${segmentSuffix(state.assistantFlushCount)}`,
          sequence: nextSequence(state, entry),
          messageId: entry.messageId,
        }
      } else {
        mergeChunk(state.assistantBuffer, entry)
        if (!state.assistantBuffer.messageId && entry.messageId) {
          state.assistantBuffer.messageId = entry.messageId
        }
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
      messageId: entry.messageId,
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
 * Batch conversion for the HTTP `/logs` endpoint. Creates a fresh converter,
 * ingests entries in their incoming order, and flushes any tail buffers —
 * guaranteeing the result is identical to what the client accumulated via SSE.
 *
 * No pre-sort: the caller must pass entries in the same order the live
 * pipeline saw them. `getLogsFromDb` already returns rows ordered by id (ULID
 * = chronological insertion order = wire order from `consumeStream`), so the
 * batch path observes the same input sequence as `liveConverter.ingest`. With
 * the strictly-monotonic `nextSequence` formula, this produces byte-identical
 * `TimelineEntry` (including `sequence`) across both paths. A defensive
 * pre-sort here would make sequences depend on canonical (turnIndex,
 * timestamp) order while the live path keeps wire order, causing post-refresh
 * timeline jumps.
 */
export function toTimeline(entries: NormalizedLogEntry[]): TimelineEntry[] {
  const conv = new TimelineConverter()
  // Track the latest snapshot per id so multi-emit ingest results collapse to
  // one entry per id (matches what the client sees after SSE upserts).
  const byId = new Map<string, TimelineEntry>()

  for (const entry of entries) {
    const produced = conv.ingest('batch', entry)
    for (const p of produced) byId.set(p.id, p)
  }
  for (const tail of conv.flush('batch')) byId.set(tail.id, tail)

  // Re-emit in sequence order — it is the canonical insertion order on the
  // client. Identical to `streamAndCollect` in tests.
  return [...byId.values()].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  )
}
