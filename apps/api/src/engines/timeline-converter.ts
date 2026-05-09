import type { NormalizedLogEntry, TimelineEntry } from './types'

const TYPE_ORDER: Record<string, number> = {
  user: 0,
  thinking: 1,
  tool: 2,
  assistant: 3,
  system: 4,
  error: 5,
}

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
  // Only filter noise for system-message entries.
  // Thinking/assistant deltas may be short fragments — never drop them.
  if (entry.entryType === 'system-message') {
    if (trimmed.length < 15 && /^[a-z]+$/.test(trimmed)) return true
    if (
      trimmed === 'ACP session loaded' ||
      trimmed === 'ACP session started' ||
      trimmed === 'ACP session initialized'
    ) return true
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

function compareTimeline(a: TimelineEntry, b: TimelineEntry): number {
  if (a.turnIndex !== b.turnIndex) return a.turnIndex - b.turnIndex
  return (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99)
}

/**
 * Convert raw NormalizedLogEntry array into a unified TimelineEntry array.
 *
 * Backend guarantees applied:
 * 1. Accumulation: thinking/assistant chunks are merged into full text per turn
 * 2. Deduplication: one thinking + one assistant per turn
 * 3. Noise filter: short pure-word entries dropped
 * 4. Ordering: by turnIndex, within turn: thinking → tool → assistant → system → error
 * 5. Stable IDs: turn-{n}-{type}
 */
/**
 * Convert a single NormalizedLogEntry to TimelineEntry (for SSE streaming).
 * Uses stable IDs so frontend can simply overwrite by id.
 */
export function toTimelineEntry(entry: NormalizedLogEntry): TimelineEntry {
  const type = mapType(entry.entryType)
  const turn = entry.turnIndex ?? 0
  const id = (type === 'thinking' || type === 'assistant')
    ? `turn-${turn}-${type}`
    : `turn-${turn}-${type}-${entry.messageId ?? Date.now()}`

  return {
    id,
    turnIndex: turn,
    type,
    content: entry.content,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    metadata: buildMetadata(entry),
  }
}

export function toTimeline(entries: NormalizedLogEntry[]): TimelineEntry[] {
  const accumulated = new Map<string, {
    content: string
    timestamp: string
    metadata: NonNullable<TimelineEntry['metadata']>
  }>()

  const direct: TimelineEntry[] = []

  for (const entry of entries) {
    if (isNoise(entry)) continue

    const type = mapType(entry.entryType)
    const turn = entry.turnIndex ?? 0

    // Only thinking and assistant need accumulation
    if (type === 'thinking' || type === 'assistant') {
      const id = `turn-${turn}-${type}`
      const existing = accumulated.get(id)
      const text = entry.content

      if (existing) {
        // Smart merge: if new text starts with old, it's a full replacement
        if (text.length > existing.content.length && text.startsWith(existing.content)) {
          existing.content = text
        } else if (existing.content.length > text.length && existing.content.startsWith(text)) {
          // Old is longer — keep old (shouldn't happen with correct backend)
        } else {
          // Fallback: concatenate (for engines that send true deltas)
          existing.content += text
        }
        existing.timestamp = entry.timestamp ?? existing.timestamp
        if (entry.metadata?.streaming === true) {
          existing.metadata.streaming = true
        }
        if (entry.metadata?.streaming === false) {
          existing.metadata.streaming = false
        }
      } else {
        accumulated.set(id, {
          content: text,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          metadata: buildMetadata(entry),
        })
      }
    } else {
      // Direct output for tool/system/error/user (no accumulation needed)
      // Each entry gets a unique id so action+result pairs are preserved
      const idSuffix = entry.messageId ?? `idx-${direct.length}`
      direct.push({
        id: `turn-${turn}-${type}-${idSuffix}`,
        turnIndex: turn,
        type,
        content: entry.content,
        timestamp: entry.timestamp ?? new Date().toISOString(),
        metadata: buildMetadata(entry),
      })
    }
  }

  // Convert accumulated entries to TimelineEntry
  for (const [id, acc] of accumulated) {
    const match = id.match(/turn-(\d+)-(thinking|assistant)/)
    if (!match) continue
    const [, turnStr, type] = match
    direct.push({
      id,
      turnIndex: parseInt(turnStr),
      type: type as 'thinking' | 'assistant',
      content: acc.content,
      timestamp: acc.timestamp,
      metadata: acc.metadata,
    })
  }

  return direct.sort(compareTimeline)
}
