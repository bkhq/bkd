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
  thinking?: NormalizedLogEntry // Attached preceding thinking
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
  thinking?: NormalizedLogEntry // Attached preceding thinking
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
  if (entry.entryType === 'system-message' && entry.metadata?.subtype === 'thinking_tokens') return true
  return false
}

export const SKILL_PATH_PATTERNS = ['.agents/skills/', '.claude/skills/', 'superpowers']

function isSkillTool(entry: TimelineEntry): boolean {
  if (entry.type !== 'tool') return false
  return isSkillEntry(entry)
}

export function isSkillEntry(entry: { metadata?: Record<string, unknown> | null, toolDetail?: { toolName?: string, raw?: Record<string, unknown> } | null }): boolean {
  const locations = (entry.metadata?.locations ?? entry.toolDetail?.raw?.locations) as Array<{ path?: string }> | undefined
  const firstPath = locations?.[0]?.path
  if (firstPath && SKILL_PATH_PATTERNS.some(p => firstPath.includes(p))) return true
  const toolName = entry.toolDetail?.toolName
  if (toolName && SKILL_PATH_PATTERNS.some(p => toolName.includes(p))) return true
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
  let pendingThinking: TimelineEntry | null = null

  function flushPendingThinking(): void {
    if (!pendingThinking) return
    items.push({
      type: 'thinking',
      id: pendingThinking.id,
      entry: pendingThinking,
      isStreaming: pendingThinking.metadata?.streaming === true,
    })
    pendingThinking = null
  }

  function flushToolBuffer(): void {
    if (toolBuffer.length === 0) return
    const toolGroupThinking = pendingThinking ?? undefined
    if (toolGroupThinking) pendingThinking = null
    const group = buildToolGroup(toolBuffer)
    items.push({ type: 'tool-group', id: group.id, message: group, thinking: toolGroupThinking })
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
      // Skip empty thinking chunks (Claude/ACP adapter sometimes emits
      // agent_thought_chunk with no content). Backend filter is the
      // primary guard; this is a safety net for edge cases.
      if (entry.content.trim().length > 0) {
        pendingThinking = entry
      }
      continue
    }

    if (entry.type === 'tool') {
      if (entry.metadata?.isResult) {
        continue
      }
      if (isSkillTool(entry)) continue
      const callId = entry.metadata?.toolCallId as string | undefined
      const result = callId ? resultMap.get(callId) ?? null : null
      toolBuffer.push({ action: entry, result })
      // Don't flush yet — adjacent tools accumulate into one group so a
      // burst of N actions renders as one card with N items. Streaming
      // still feels real-time because rebuild runs on every log change
      // and the end-of-loop flushToolBuffer() emits the in-flight group
      // on every render.
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

    // Note: previously we deleted a preceding thinking block when the
    // assistant content started with the same text, on the assumption that
    // the assistant was just a richer repeat of the thinking. That heuristic
    // fires constantly because models commonly open the reply with the same
    // sentence as the reasoning ("让我看看 X" → "让我看看 X，发现..."),
    // so the whole thinking block silently vanished. Thinking is its own
    // surface — keep it; if the duplication bothers users, they can collapse
    // the thinking <details> block.

    const attachedThinking = pendingThinking ?? undefined
    pendingThinking = null
    items.push({ type: 'entry', id: entry.id, entry, thinking: attachedThinking })
  }

  flushToolBuffer()
  flushPendingThinking()
  return { items, pendingMessages }
}

export function useAcpTimeline(logs: TimelineEntry[]): AcpTimelineResult {
  return useMemo(() => rebuildAcpTimeline(logs), [logs])
}
