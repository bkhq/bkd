import type {
  NormalizedLogEntry,
  TaskPlanChatMessage,
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

function entryId(entry: NormalizedLogEntry, fallback: string): string {
  return entry.messageId ?? fallback
}

function hasResultFlag(entry: NormalizedLogEntry): boolean {
  return (
    entry.toolDetail?.isResult === true ||
    (entry.metadata?.isResult as boolean | undefined) === true
  )
}

function isToolUseAction(entry: NormalizedLogEntry): boolean {
  return entry.entryType === 'tool-use' && !hasResultFlag(entry)
}

function isToolUseResult(entry: NormalizedLogEntry): boolean {
  return entry.entryType === 'tool-use' && hasResultFlag(entry)
}

function shouldHideAcpEntry(entry: NormalizedLogEntry): boolean {
  if (entry.entryType === 'loading' || entry.entryType === 'token-usage') return true

  if (entry.entryType === 'user-message' && entry.metadata?.type === 'system') {
    return true
  }

  if (entry.entryType !== 'system-message') return false

  const subtype = entry.metadata?.subtype
  if (
    subtype === 'init' ||
    subtype === 'task_progress' ||
    subtype === 'stop_hook_summary' ||
    subtype === 'task_notification'
  ) {
    return true
  }

  if (
    entry.content === 'ACP session loaded' ||
    entry.content === 'ACP session started' ||
    entry.content === 'ACP session initialized'
  ) {
    return true
  }

  // Filter out meaningless short system noise (e.g. raw "version" text
  // from ACP protocol that isn't a real system event).
  if (entry.content.length < 15 && /^[a-z]+$/.test(entry.content.trim())) {
    return true
  }

  return false
}

function rebuildAcpTimeline(entries: NormalizedLogEntry[]): AcpTimelineResult {
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${++seq}`

  const items: AcpTimelineItem[] = []
  const pendingMessages: NormalizedLogEntry[] = []
  const resultMap = new Map<string, NormalizedLogEntry>()
  const pairedResultCallIds = new Set<string>()

  for (const entry of entries) {
    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      if (callId) resultMap.set(callId, entry)
    }
  }

  let pendingStreamingAssistant: NormalizedLogEntry | null = null
  /**
   * Tracks which turnIndex had its streaming assistant already flushed,
   *  so the non-streaming duplicate from acp-prompt-result is skipped.
   */
  let flushedStreamingTurnIndex: number | undefined
  let toolBuffer: ToolGroupItem[] = []
  /** Caches the latest thinking entry for potential merging with assistant-message. */
  let pendingThinking: NormalizedLogEntry | null = null

  function buildToolGroup(toolItems: ToolGroupItem[]): ToolGroupChatMessage {
    const stats: Record<string, number> = {}
    for (const item of toolItems) {
      const kind = item.action.toolDetail?.kind ?? item.action.toolAction?.kind ?? 'other'
      stats[kind] = (stats[kind] ?? 0) + 1
    }

    const stableId = toolItems[0]?.action.messageId ?? nextId('acp-tg')
    return {
      type: 'tool-group',
      id: `acp-tg-${stableId}`,
      items: toolItems,
      stats,
      count: toolItems.length,
      hiddenCount: 0,
    }
  }

  function flushToolBuffer(): void {
    if (toolBuffer.length === 0) return
    const message = buildToolGroup(toolBuffer)
    items.push({
      type: 'tool-group',
      id: message.id,
      message,
    })
    toolBuffer = []
  }

  function flushStreamingAssistant(): void {
    if (!pendingStreamingAssistant) return
    // If assistant already contains the thinking content, discard thinking
    // instead of rendering it as a standalone entry (avoids duplication).
    if (
      pendingThinking
      && pendingStreamingAssistant.content.startsWith(pendingThinking.content)
    ) {
      pendingThinking = null
    }
    // Order: thinking -> tool calls -> assistant
    if (pendingThinking) {
      items.push({
        type: 'thinking',
        id: entryId(pendingThinking, nextId('acp-thinking')),
        entry: pendingThinking,
        isStreaming: false,
      })
      pendingThinking = null
    }
    flushToolBuffer()
    items.push({
      type: 'entry',
      id: entryId(pendingStreamingAssistant, nextId('acp-entry')),
      entry: pendingStreamingAssistant,
    })
    flushedStreamingTurnIndex = pendingStreamingAssistant.turnIndex
    pendingStreamingAssistant = null
  }

  function pushEntry(entry: NormalizedLogEntry): void {
    if (
      entry.entryType === 'user-message' &&
      (entry.metadata?.type === 'pending' || entry.metadata?.type === 'done')
    ) {
      pendingMessages.push(entry)
      return
    }

    // If there's a cached thinking for this turn, flush it before the assistant.
    if (
      entry.entryType === 'assistant-message' &&
      pendingThinking &&
      pendingThinking.turnIndex === entry.turnIndex
    ) {
      // Discard if assistant already contains the thinking content.
      if (entry.content.startsWith(pendingThinking.content)) {
        pendingThinking = null
      } else {
        flushToolBuffer()
        items.push({
          type: 'thinking',
          id: entryId(pendingThinking, nextId('acp-thinking')),
          entry: pendingThinking,
          isStreaming: false,
        })
        pendingThinking = null
      }
    }

    flushToolBuffer()
    items.push({
      type: 'entry',
      id: entryId(entry, nextId('acp-entry')),
      entry,
    })
  }

  for (const entry of entries) {
    if (shouldHideAcpEntry(entry)) continue

    // thinking: cache for potential merging with the following assistant-message.
    // When the engine streams thinking and message as identical text, we skip
    // the standalone thinking display to avoid duplication.
    // Only streaming thinking is cached. Non-streaming thinking (e.g. Codex
    // reasoning items persisted to DB) is output immediately to avoid
    // concatenating multiple independent thinking entries.
    // Skip empty/very short thinking fragments (< 10 chars) — these are
    // typically noise from ACP protocol, not real reasoning content.
    if (entry.entryType === 'thinking') {
      if ((entry.content?.length ?? 0) < 10) {
        continue
      }
      if (entry.metadata?.streaming === true) {
        if (pendingThinking && pendingThinking.turnIndex === entry.turnIndex) {
          const current = pendingThinking as NormalizedLogEntry
          const prevText = current.content
          const nextText = entry.content
          const isFullContent = nextText.startsWith(prevText)
          // Fix: if not full content and text is unrelated (e.g. a new
          // reasoning segment), flush the old thinking and start fresh
          // instead of concatenating unrelated thoughts into garbage.
          if (!isFullContent && prevText.length > 20 && nextText.length > 20) {
            flushToolBuffer()
            items.push({
              type: 'thinking',
              id: entryId(current, nextId('acp-thinking')),
              entry: current,
              isStreaming: true,
            })
            pendingThinking = { ...entry }
          } else {
            pendingThinking = {
              ...current,
              content: isFullContent ? nextText : `${prevText}${nextText}`,
              timestamp: entry.timestamp ?? current.timestamp,
            }
          }
        } else {
          pendingThinking = { ...entry }
        }
      } else {
        // Non-streaming thinking: output immediately, don't merge.
        flushToolBuffer()
        items.push({
          type: 'thinking',
          id: entryId(entry, nextId('acp-thinking')),
          entry,
          isStreaming: false,
        })
      }
      continue
    }

    if (
      entry.entryType === 'assistant-message' &&
      entry.metadata?.streaming === true
    ) {
      // If assistant contains the thinking content, discard the thinking
      if (
        pendingThinking &&
        pendingThinking.turnIndex === entry.turnIndex &&
        entry.content.startsWith(pendingThinking.content)
      ) {
        pendingThinking = null
      }
      if (
        pendingStreamingAssistant &&
        pendingStreamingAssistant.turnIndex === entry.turnIndex
      ) {
        const current: NormalizedLogEntry = pendingStreamingAssistant
        const prev = current.content
        const next = entry.content
        const isFullContent = next.startsWith(prev)
        // Fix: never concatenate unrelated chunks. If not full content,
        // assume it's the latest full version (some agents send corrected
        // accumulated text that doesn't start with previous).
        pendingStreamingAssistant = {
          ...current,
          content: isFullContent ? next : (next.length > prev.length ? next : prev),
          timestamp: entry.timestamp ?? current.timestamp,
        }
      } else {
        // Only flush the previous turn's assistant; don't flush thinking here.
        if (pendingStreamingAssistant) {
          flushStreamingAssistant()
        }
        pendingStreamingAssistant = { ...entry }
      }
      continue
    }

    if (
      entry.entryType === 'assistant-message' &&
      pendingStreamingAssistant &&
      pendingStreamingAssistant.turnIndex === entry.turnIndex
    ) {
      pendingStreamingAssistant = null
      pushEntry(entry)
      continue
    }

    // Non-streaming assistant for a turn whose streaming version was already
    // flushed (e.g. streaming chunks → tool calls → acp-prompt-result).
    // The streaming version is already displayed; skip the duplicate.
    if (
      entry.entryType === 'assistant-message' &&
      !pendingStreamingAssistant &&
      flushedStreamingTurnIndex !== undefined &&
      flushedStreamingTurnIndex === entry.turnIndex
    ) {
      continue
    }

    flushStreamingAssistant()

    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      // Skip results that are already paired with an action.
      if (callId && pairedResultCallIds.has(callId)) continue

      // Orphaned result (no matching action): skip it.
      // Results are always displayed as part of their action's tool group.
      continue
    }

    if (isToolUseAction(entry)) {
      // Flush orphaned results before starting a new action batch
      if (toolBuffer.length > 0 && toolBuffer.some(item => hasResultFlag(item.action))) {
        flushToolBuffer()
      }
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      let result: NormalizedLogEntry | null = null
      if (callId) {
        result = resultMap.get(callId) ?? null
        if (result) pairedResultCallIds.add(callId)
      }
      toolBuffer.push({
        action: entry,
        result,
      })
      continue
    }

    if (entry.entryType === 'system-message' && entry.metadata?.subtype === 'plan') {
      const todos = extractTodos(entry)
      if (todos) {
        flushToolBuffer()
        items.push({
          type: 'plan',
          id: entryId(entry, nextId('acp-plan')),
          entry,
          todos,
          completedCount: todos.filter(todo => todo.status === 'completed').length,
        })
        continue
      }
    }

    pushEntry(entry)
  }

  flushStreamingAssistant()
  // If thinking stream hasn't finished, add it as a streaming item.
  // Insert BEFORE the first assistant message of the same turn so the
  // thinking appears in the correct logical position (not at the very
  // bottom of the timeline).
  if (pendingThinking) {
    const insertIndex = items.findIndex((i) => {
      if (i.type !== 'entry') return false
      const ent = (i as { entry: NormalizedLogEntry }).entry
      return ent.entryType === 'assistant-message' && ent.turnIndex === pendingThinking!.turnIndex
    })
    const thinkingItem: AcpTimelineThinkingItem = {
      type: 'thinking',
      id: entryId(pendingThinking, nextId('acp-thinking')),
      entry: pendingThinking,
      isStreaming: true,
    }
    if (insertIndex !== -1) {
      items.splice(insertIndex, 0, thinkingItem)
    } else {
      items.push(thinkingItem)
    }
    pendingThinking = null
  }
  flushToolBuffer()

  // Deduplicate: if the same turn has multiple thinking items with
  // overlapping content (e.g. one from older logs and one from live
  // streaming), keep only the longer one. Preserve distinct thoughts.
  const turnThinkingMap = new Map<number | undefined, number>() // turnIndex -> lastSeenIndex
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'thinking') {
      const turn = item.entry.turnIndex
      const lastIdx = turnThinkingMap.get(turn)
      if (lastIdx !== undefined) {
        const lastContent = (items[lastIdx] as { entry: NormalizedLogEntry }).entry.content
        const currentContent = item.entry.content
        // If one is a superset of the other, keep the longer one
        if (
          lastContent.startsWith(currentContent) ||
          currentContent.startsWith(lastContent) ||
          lastContent.endsWith(currentContent) ||
          currentContent.endsWith(lastContent)
        ) {
          // Remove the shorter one
          if (lastContent.length >= currentContent.length) {
            items.splice(i, 1)
          } else {
            items.splice(lastIdx, 1)
            turnThinkingMap.set(turn, i)
          }
          continue
        }
      }
      turnThinkingMap.set(turn, i)
    }
  }

  return { items, pendingMessages }
}

export function useAcpTimeline(logs: NormalizedLogEntry[]): AcpTimelineResult {
  return useMemo(() => rebuildAcpTimeline(logs), [logs])
}
