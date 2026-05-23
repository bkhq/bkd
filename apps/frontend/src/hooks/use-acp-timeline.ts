import type {
  NormalizedLogEntry,
  TaskPlanChatMessage,
  TimelineEntry,
  ToolGroupChatMessage,
  ToolGroupItem,
} from '@bkd/shared'
import { useMemo } from 'react'
import { extractTodos } from './use-chat-messages'

export interface AcpTimelineEntryItem {
  type: 'entry'
  id: string
  entry: NormalizedLogEntry
}

export interface AcpTimelinePlanItem {
  type: 'plan'
  id: string
  entry: NormalizedLogEntry
  todos: TaskPlanChatMessage['todos']
  completedCount: number
}

export interface AcpTimelineToolGroupItem {
  type: 'tool-group'
  id: string
  message: ToolGroupChatMessage
}

export interface AcpTimelineThinkingItem {
  type: 'thinking'
  id: string
  entry: NormalizedLogEntry
  isStreaming: boolean
}

export type AcpTimelineItem =
  | AcpTimelineEntryItem
  | AcpTimelinePlanItem
  | AcpTimelineToolGroupItem
  | AcpTimelineThinkingItem

export interface AcpTimelineResult {
  items: AcpTimelineItem[]
  pendingMessages: NormalizedLogEntry[]
}

function isHiddenEntry(entry: TimelineEntry): boolean {
  if (entry.entryType === 'loading' || entry.entryType === 'token-usage') return true
  if (entry.entryType === 'user-message' && entry.metadata?.type === 'system') return true
  return false
}

/**
 * Map heterogeneous engine kind names to the canonical ToolAction.kind union.
 *
 * Engine-side conventions are inconsistent: ACP/opencode stores
 * `metadata.kind = "execute" | "read" | "edit"` while the typed
 * ToolAction.kind union uses "command-run" | "file-read" | "file-edit".
 * Without normalization, every tool falls through to "other" in stats
 * (root cause 9: "5 other" labels for groups containing only known tools).
 */
function normalizeKind(raw: string | undefined): string {
  if (!raw) return 'other'
  switch (raw) {
    case 'read':
    case 'file-read': return 'file-read'
    case 'edit':
    case 'write':
    case 'file-edit': return 'file-edit'
    case 'execute':
    case 'bash':
    case 'command-run': return 'command-run'
    case 'search':
    case 'grep':
    case 'glob': return 'search'
    case 'fetch':
    case 'web-fetch': return 'web-fetch'
    case 'agent': return 'agent'
    case 'task-plan': return 'task-plan'
    case 'user-question': return 'user-question'
    default: return 'other'
  }
}

function pickKind(item: ToolGroupItem): string {
  const md = item.action.metadata as Record<string, unknown> | undefined
  return normalizeKind(
    item.action.toolDetail?.kind
    ?? item.action.toolAction?.kind
    ?? (typeof md?.kind === 'string' ? (md.kind as string) : undefined),
  )
}

function buildToolGroup(items: ToolGroupItem[]): ToolGroupChatMessage {
  const stats: Record<string, number> = {}
  for (const item of items) {
    const kind = pickKind(item)
    stats[kind] = (stats[kind] ?? 0) + 1
  }
  // Stable group id derived from the first action's id (or messageId).
  // Crucially NOT Date.now() — that fallback drifted between calls inside
  // the same useMemo, causing React keys to change on every chunk and the
  // entire group to unmount/remount (root cause 6).
  const first = items[0]?.action
  const stableId = first?.messageId
    ?? (first as TimelineEntry | undefined)?.id
    ?? first?.toolDetail?.toolCallId
    ?? `tg-${items.length}`
  return {
    type: 'tool-group',
    id: `acp-tg-${stableId}`,
    items,
    stats,
    count: items.length,
    hiddenCount: 0,
  }
}

/**
 * Pure mapping from backend-normalized TimelineEntry[] → AcpTimelineItem[].
 *
 * Backend's TimelineConverter already guarantees:
 *   - segment splitting (multi-thinking / multi-assistant per turn)
 *   - chunk merging (cumulative + delta)
 *   - deduplication, ordering (via sequence), noise filtering
 *
 * This layer only does what the backend can't:
 *   - Tool action ↔ result pairing for the ToolGroupMessage UI
 *   - Plan extraction from system-message subtype=plan
 *   - Pending message segregation
 *   - Adjacent tools collapsed into a single visual group
 *
 * No more thinking dedup heuristics — the converter splits segments into
 * distinct entries with distinct ids. No more chunk merging — content is
 * already accumulated upstream.
 */
function rebuildAcpTimeline(entries: TimelineEntry[]): AcpTimelineResult {
  // Trust backend ordering. Entries already arrive sorted by sequence (use-issue-stream
  // does the merge sort) — no need to re-sort here.
  const items: AcpTimelineItem[] = []
  const pendingMessages: NormalizedLogEntry[] = []

  // Pre-pass: collect tool results by callId so actions can pair with results
  // regardless of arrival order.
  const resultMap = new Map<string, TimelineEntry>()
  for (const entry of entries) {
    if (entry.type === 'tool' && entry.metadata?.isResult) {
      const callId = entry.metadata?.toolCallId as string | undefined
      if (callId) resultMap.set(callId, entry)
    }
  }

  let toolBuffer: ToolGroupItem[] = []
  // Track the most recent thinking entry for deduplication. OpenCode sometimes
  // sends thinking chunks whose content is a prefix of the subsequent assistant
  // message. Without this, users see the same text twice — once as a thinking
  // block and again inside the assistant reply.
  let lastThinkingEntry: TimelineEntry | null = null
  let lastThinkingItemIndex = -1

  function flushToolBuffer() {
    if (toolBuffer.length === 0) return
    const group = buildToolGroup(toolBuffer)
    items.push({ type: 'tool-group', id: group.id, message: group })
    toolBuffer = []
  }

  for (const entry of entries) {
    if (isHiddenEntry(entry)) continue

    if (entry.entryType === 'user-message' && (entry.metadata?.type === 'pending' || entry.metadata?.type === 'done')) {
      pendingMessages.push(entry)
      continue
    }

    if (entry.type === 'thinking') {
      flushToolBuffer()
      lastThinkingEntry = entry
      lastThinkingItemIndex = items.length
      items.push({
        type: 'thinking',
        id: entry.id,
        entry,
        isStreaming: entry.metadata?.streaming === true,
      })
      continue
    }

    if (entry.type === 'tool') {
      if (entry.metadata?.isResult) {
        // Results are attached to actions in the action branch below.
        continue
      }
      const callId = entry.metadata?.toolCallId as string | undefined
      const result = callId ? resultMap.get(callId) ?? null : null
      toolBuffer.push({ action: entry, result })
      // Flush immediately so tools appear as they start executing
      flushToolBuffer()
      continue
    }

    if (entry.entryType === 'system-message' && entry.metadata?.subtype === 'plan') {
      const todos = extractTodos(entry)
      if (todos) {
        flushToolBuffer()
        items.push({
          type: 'plan',
          id: entry.id,
          entry,
          todos,
          completedCount: todos.filter(todo => todo.status === 'completed').length,
        })
        continue
      }
    }

    flushToolBuffer()

    // If the next message is an assistant that already contains the thinking
    // content, skip the standalone thinking display. OpenCode sometimes repeats
    // the entire thinking text inside the assistant message (even after tool
    // calls), which makes the UI feel like "thinking and reply merged together".
    // We remove the thinking block so only the formatted assistant reply remains.
    if (entry.type === 'assistant' && lastThinkingEntry) {
      if (entry.content.startsWith(lastThinkingEntry.content)) {
        // Remove the previous thinking item if it's still in items
        if (
          lastThinkingItemIndex >= 0
          && lastThinkingItemIndex < items.length
          && items[lastThinkingItemIndex]?.type === 'thinking'
        ) {
          items.splice(lastThinkingItemIndex, 1)
        }
      }
      lastThinkingEntry = null
      lastThinkingItemIndex = -1
    }

    items.push({ type: 'entry', id: entry.id, entry })
  }

  flushToolBuffer()
  return { items, pendingMessages }
}

export function useAcpTimeline(logs: TimelineEntry[]): AcpTimelineResult {
  return useMemo(() => rebuildAcpTimeline(logs), [logs])
}
