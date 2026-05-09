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

function buildToolGroup(items: ToolGroupItem[]): ToolGroupChatMessage {
  const stats: Record<string, number> = {}
  for (const item of items) {
    const kind = item.action.toolDetail?.kind ?? item.action.toolAction?.kind ?? 'other'
    stats[kind] = (stats[kind] ?? 0) + 1
  }
  const stableId = items[0]?.action.messageId ?? `tg-${Date.now()}`
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
 * Simplified timeline builder.
 * Backend TimelineConverter already guarantees:
 * - deduplication, accumulation, ordering, noise filtering
 * This layer only handles: tool pairing, plan extraction, pending messages.
 */
const TYPE_ORDER: Record<string, number> = {
  user: 0,
  thinking: 1,
  tool: 2,
  assistant: 3,
  system: 4,
  error: 5,
}

function compareEntry(a: TimelineEntry, b: TimelineEntry): number {
  const ta = a.turnIndex ?? 0
  const tb = b.turnIndex ?? 0
  if (ta !== tb) return ta - tb
  return (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99)
}

function rebuildAcpTimeline(entries: TimelineEntry[]): AcpTimelineResult {
  const sorted = [...entries].sort(compareEntry)
  const items: AcpTimelineItem[] = []
  const pendingMessages: NormalizedLogEntry[] = []
  const resultMap = new Map<string, TimelineEntry>()

  // Collect tool results
  for (const entry of sorted) {
    if (entry.type === 'tool' && entry.metadata?.isResult) {
      const callId = entry.metadata?.toolCallId as string | undefined
      if (callId) resultMap.set(callId, entry)
    }
  }

  const pairedCallIds = new Set<string>()
  let toolBuffer: ToolGroupItem[] = []

  function flushToolBuffer() {
    if (toolBuffer.length === 0) return
    items.push({ type: 'tool-group', id: buildToolGroup(toolBuffer).id, message: buildToolGroup(toolBuffer) })
    toolBuffer = []
  }

  for (const entry of sorted) {
    if (isHiddenEntry(entry)) continue

    if (entry.entryType === 'user-message' && (entry.metadata?.type === 'pending' || entry.metadata?.type === 'done')) {
      pendingMessages.push(entry)
      continue
    }

    if (entry.type === 'thinking') {
      // Skip if a later assistant in the same turn already contains this thinking
      const hasEnclosingAssistant = sorted.some(e =>
        e.type === 'assistant'
        && (e.turnIndex ?? 0) === (entry.turnIndex ?? 0)
        && e.content.startsWith(entry.content),
      )
      if (hasEnclosingAssistant) continue
      flushToolBuffer()
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
        const callId = entry.metadata?.toolCallId as string | undefined
        if (callId && pairedCallIds.has(callId)) continue
        // Orphaned result — skip (will be paired with action below)
        continue
      }
      // Tool action
      const callId = entry.metadata?.toolCallId as string | undefined
      const result = callId ? resultMap.get(callId) ?? null : null
      if (result) pairedCallIds.add(callId!)
      toolBuffer.push({ action: entry, result })
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
    items.push({ type: 'entry', id: entry.id, entry })
  }

  flushToolBuffer()
  return { items, pendingMessages }
}

export function useAcpTimeline(logs: TimelineEntry[]): AcpTimelineResult {
  return useMemo(() => rebuildAcpTimeline(logs), [logs])
}
