import type {
  AssistantChatMessage,
  ChatMessage,
  ErrorChatMessage,
  NormalizedLogEntry,
  SubagentAttribution,
  SubagentItem,
  SubagentThread,
  SystemChatMessage,
  TaskPlanChatMessage,
  ThinkingChatMessage,
  ToolGroupChatMessage,
  ToolGroupItem,
  UserChatMessage,
} from '@bkd/shared'
import { useMemo } from 'react'

// ---------- Helpers ----------

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

function getToolName(entry: NormalizedLogEntry): string | undefined {
  return entry.toolDetail?.toolName ?? (entry.metadata?.toolName as string | undefined)
}

function isTodoWriteEntry(entry: NormalizedLogEntry): boolean {
  return getToolName(entry) === 'TodoWrite'
}

function entryId(entry: NormalizedLogEntry, fallback: string): string {
  return entry.messageId ?? fallback
}

function toolCallIdOf(entry: NormalizedLogEntry): string | undefined {
  return entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
}

// ---------- Subagent threads ----------

/** Lifecycle events the CLI emits for a dispatched subagent. */
const SUBAGENT_LIFECYCLE_SUBTYPES = new Set(['task_started', 'task_progress', 'task_notification'])

type SubagentStatus = Omit<SubagentThread, 'toolCallId' | 'items'>

function subagentOf(entry: NormalizedLogEntry): SubagentAttribution | undefined {
  const attribution = entry.metadata?.subagent as SubagentAttribution | undefined
  return attribution?.toolCallId ? attribution : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Fold one lifecycle event into the running status for its subagent. */
function mergeLifecycle(
  current: SubagentStatus,
  subtype: string,
  meta: Record<string, unknown>,
): SubagentStatus {
  switch (subtype) {
    case 'task_started':
      return {
        ...current,
        status: 'running',
        type: str(meta.subagentType) ?? current.type,
        description: str(meta.description) ?? current.description,
      }
    case 'task_progress':
      // `description` here is a live activity label ("Reading a.txt"), not the
      // dispatch description — keep the original.
      return {
        ...current,
        status: current.status ?? 'running',
        type: str(meta.subagentType) ?? current.type,
        lastToolName: str(meta.lastToolName) ?? current.lastToolName,
        toolUses: num(meta.toolUses) ?? current.toolUses,
        totalTokens: num(meta.totalTokens) ?? current.totalTokens,
        durationMs: num(meta.durationMs) ?? current.durationMs,
      }
    case 'task_notification':
      return {
        ...current,
        status: str(meta.status) === 'completed' ? 'completed' : 'failed',
        summary: str(meta.summary) ?? current.summary,
        toolUses: num(meta.toolUses) ?? current.toolUses,
        totalTokens: num(meta.totalTokens) ?? current.totalTokens,
        durationMs: num(meta.durationMs) ?? current.durationMs,
      }
    default:
      return current
  }
}

function buildSubagentThread(
  toolCallId: string,
  inner: NormalizedLogEntry[],
  status: SubagentStatus,
): SubagentThread {
  const results = new Map<string, NormalizedLogEntry>()
  for (const entry of inner) {
    if (!isToolUseResult(entry)) continue
    const callId = toolCallIdOf(entry)
    if (callId) results.set(callId, entry)
  }

  const items: SubagentItem[] = []
  for (const entry of inner) {
    if (isToolUseResult(entry)) continue
    if (isToolUseAction(entry)) {
      const callId = toolCallIdOf(entry)
      items.push({
        kind: 'tool',
        item: { action: entry, result: callId ? results.get(callId) ?? null : null },
      })
      continue
    }
    if (!entry.content) continue
    if (entry.entryType === 'thinking') items.push({ kind: 'thinking', entry })
    else if (entry.entryType === 'assistant-message') items.push({ kind: 'text', entry })
  }

  const attribution = inner.map(subagentOf).find(Boolean)
  return {
    ...status,
    toolCallId,
    type: status.type ?? attribution?.type,
    description: status.description ?? attribution?.description,
    items,
  }
}

/**
 * Split forwarded subagent turns and their lifecycle events out of the main
 * timeline, and reassemble them into one thread per dispatching tool call.
 */
function partitionSubagents(rawEntries: NormalizedLogEntry[]): {
  entries: NormalizedLogEntry[]
  subagentThreads: Map<string, SubagentThread>
} {
  const entries: NormalizedLogEntry[] = []
  const inner = new Map<string, NormalizedLogEntry[]>()
  const status = new Map<string, SubagentStatus>()

  for (const entry of rawEntries) {
    const attribution = subagentOf(entry)
    if (attribution) {
      const existing = inner.get(attribution.toolCallId)
      if (existing) existing.push(entry)
      else inner.set(attribution.toolCallId, [entry])
      continue
    }

    const subtype = entry.metadata?.subtype as string | undefined
    if (entry.entryType === 'system-message' && subtype && SUBAGENT_LIFECYCLE_SUBTYPES.has(subtype)) {
      const callId = str(entry.metadata?.toolCallId)
      if (callId) {
        status.set(callId, mergeLifecycle(status.get(callId) ?? {}, subtype, entry.metadata ?? {}))
      }
      continue
    }

    entries.push(entry)
  }

  const subagentThreads = new Map<string, SubagentThread>()
  for (const callId of new Set([...inner.keys(), ...status.keys()])) {
    subagentThreads.set(
      callId,
      buildSubagentThread(callId, inner.get(callId) ?? [], status.get(callId) ?? {}),
    )
  }
  return { entries, subagentThreads }
}

// ---------- TodoWrite → TaskPlan ----------

export function extractTodos(entry: NormalizedLogEntry): TaskPlanChatMessage['todos'] | null {
  const meta = entry.metadata
  if (!meta) return null
  const args = (meta.arguments ?? meta.input) as
    | {
      todos?: Array<{ content: string, status: string, activeForm?: string }>
    } |
    undefined
  if (args?.todos && Array.isArray(args.todos)) {
    return args.todos.map(t => ({
      content: t.content ?? '',
      status: t.status ?? 'pending',
      activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
    }))
  }

  const planEntries = meta.entries as
    | Array<{ content?: string, status?: string }>
    | undefined
  if (!planEntries || !Array.isArray(planEntries)) return null
  return planEntries.map(entry => ({
    content: entry.content ?? '',
    status: entry.status ?? 'pending',
  }))
}

// ---------- Main rebuild ----------

export function rebuildMessages(rawEntries: NormalizedLogEntry[]): ChatMessage[] {
  // Subagent turns are nested under the tool call that dispatched them, so
  // they must not take part in main-timeline grouping.
  const { entries, subagentThreads } = partitionSubagents(rawEntries)

  // Local counter — avoids module-level singleton race when multiple
  // components call useChatMessages concurrently.
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-${++seq}`

  const messages: ChatMessage[] = []
  let toolBuffer: ToolGroupItem[] = []
  // Deferred thinking entry — consumed by the next tool group as its description,
  // or flushed as a standalone thinking message if no tool calls follow.
  let pendingThinking: { content: string, entry: NormalizedLogEntry } | null = null

  // Build turn → duration map from system-message metadata
  const turnDuration = new Map<number, number>()
  for (const entry of entries) {
    if (entry.entryType === 'system-message' && typeof entry.metadata?.duration === 'number') {
      turnDuration.set(entry.turnIndex ?? 0, entry.metadata.duration as number)
    }
  }

  // Build result lookup: toolCallId → entry
  const resultMap = new Map<string, NormalizedLogEntry>()
  // Track which results get paired with an action
  const pairedResultCallIds = new Set<string>()
  for (const entry of entries) {
    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      if (callId) resultMap.set(callId, entry)
    }
  }

  // Pre-build command_output index: for each command user-message index,
  // find the next command_output system-message. This avoids O(n) indexOf
  // inside the main loop and prevents cross-command mismatches.
  const commandOutputByIdx = new Map<number, number>()
  const consumedOutputIdx = new Set<number>()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.entryType === 'user-message' && e.metadata?.type === 'command') {
      for (let j = i + 1; j < entries.length; j++) {
        const c = entries[j]
        if (
          c.entryType === 'system-message' &&
          c.metadata?.subtype === 'command_output' &&
          !consumedOutputIdx.has(j)
        ) {
          commandOutputByIdx.set(i, j)
          consumedOutputIdx.add(j)
          break
        }
      }
    }
  }

  function buildToolGroup(items: ToolGroupItem[], description?: string): ToolGroupChatMessage {
    const withSubagents = items.map((item) => {
      const callId = toolCallIdOf(item.action)
      const thread = callId ? subagentThreads.get(callId) : undefined
      return thread ? { ...item, subagent: thread } : item
    })
    const stats: Record<string, number> = {}
    for (const item of items) {
      const kind = item.action.toolDetail?.kind ?? item.action.toolAction?.kind ?? 'other'
      stats[kind] = (stats[kind] ?? 0) + 1
    }
    // Stable ID from first action's messageId — prevents React key changes
    // when new tool entries arrive and the message list is rebuilt.
    const stableId = items[0]?.action.messageId ?? nextId('tg')
    return {
      type: 'tool-group',
      id: `tg-${stableId}`,
      items: withSubagents,
      stats,
      count: items.length,
      hiddenCount: 0,
      description,
    }
  }

  function flushPendingThinking(): void {
    if (!pendingThinking) return
    messages.push({
      type: 'thinking',
      id: entryId(pendingThinking.entry, nextId('th')),
      entry: pendingThinking.entry,
    } satisfies ThinkingChatMessage)
    pendingThinking = null
  }

  function flushToolBuffer(): void {
    if (toolBuffer.length === 0) return

    const todoItems = toolBuffer.filter(item => isTodoWriteEntry(item.action))
    const nonTodoItems = toolBuffer.filter(item => !isTodoWriteEntry(item.action))

    // Save thinking before task-plan flush so non-todo tools can still use it
    const savedThinking = pendingThinking

    if (todoItems.length > 0) {
      const lastTodo = todoItems.at(-1)!
      const todos = extractTodos(lastTodo.action)
      if (todos) {
        if (nonTodoItems.length === 0) {
          // No other tools to absorb thinking — flush it as standalone
          flushPendingThinking()
        }
        messages.push({
          type: 'task-plan',
          id: entryId(lastTodo.action, nextId('tp')),
          entry: lastTodo.action,
          todos,
          completedCount: todos.filter(t => t.status === 'completed').length,
        } satisfies TaskPlanChatMessage)
      }
    }

    if (nonTodoItems.length > 0) {
      // Consume deferred thinking as tool group description
      const desc = savedThinking?.content
      pendingThinking = null
      messages.push(buildToolGroup(nonTodoItems, desc))
    } else if (pendingThinking) {
      // No tool items consumed the thinking — flush it as standalone
      flushPendingThinking()
    }

    toolBuffer = []
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]

    // Skip result entries that were paired with their action
    if (isToolUseResult(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      if (callId && pairedResultCallIds.has(callId)) continue
      // Unpaired result (action not in this slice) — render as standalone
      flushToolBuffer()
      toolBuffer.push({ action: entry, result: null })
      flushToolBuffer()
      continue
    }

    if (isToolUseAction(entry)) {
      const callId =
        entry.toolDetail?.toolCallId ?? (entry.metadata?.toolCallId as string | undefined)
      let result: NormalizedLogEntry | null = null
      if (callId) {
        result = resultMap.get(callId) ?? null
        if (result) pairedResultCallIds.add(callId)
      }
      toolBuffer.push({ action: entry, result })
      continue
    }

    // ── Inline entries that do NOT break the current tool group ──

    // stop_hook_summary: skip — no user-facing value, must not break tool
    // groups. The task_* subtypes were already consumed by partitionSubagents.
    if (entry.entryType === 'system-message' && entry.metadata?.subtype === 'stop_hook_summary') {
      continue
    }

    // error-message: display inline, never breaks tool groups
    if (entry.entryType === 'error-message') {
      messages.push({
        type: 'error',
        id: entryId(entry, nextId('err')),
        entry,
      } satisfies ErrorChatMessage)
      continue
    }

    // thinking: defer for next tool group description, never breaks tool groups
    if (entry.entryType === 'thinking') {
      flushPendingThinking()
      pendingThinking = entry.content ? { content: entry.content, entry } : null
      if (!pendingThinking) {
        messages.push({
          type: 'thinking',
          id: entryId(entry, nextId('th')),
          entry,
        } satisfies ThinkingChatMessage)
      }
      continue
    }

    // system-message: display inline, never breaks tool groups
    if (entry.entryType === 'system-message') {
      if (consumedOutputIdx.has(i)) continue
      flushPendingThinking()
      messages.push({
        type: 'system',
        id: entryId(entry, nextId('sys')),
        entry,
        subtype: (entry.metadata?.subtype as string | undefined) ?? 'info',
      } satisfies SystemChatMessage)
      continue
    }

    // Skip non-visible entries
    if (entry.entryType === 'token-usage' || entry.entryType === 'loading') {
      continue
    }

    // ── Conversation messages flush the tool group ──
    flushToolBuffer()
    flushPendingThinking()

    switch (entry.entryType) {
      case 'user-message': {
        const metaType = entry.metadata?.type as string | undefined
        const attachments = (entry.metadata?.attachments ?? []) as Array<{
          id: string
          name: string
          mimeType: string
          size: number
        }>
        const status =
          metaType === 'pending' ?
            'pending' :
            metaType === 'done' ?
              'done' :
              metaType === 'command' ?
                'command' :
                'normal'
        const msg: UserChatMessage = {
          type: 'user',
          id: entryId(entry, nextId('um')),
          entry,
          attachments,
          status: status as UserChatMessage['status'],
        }
        // Pair command user-messages with their pre-indexed command_output
        if (status === 'command') {
          const outputIdx = commandOutputByIdx.get(i)
          if (outputIdx !== undefined) {
            msg.commandOutput = entries[outputIdx]
          }
        }
        messages.push(msg)
        break
      }

      case 'assistant-message':
        messages.push({
          type: 'assistant',
          id: entryId(entry, nextId('am')),
          entry,
          durationMs: turnDuration.get(entry.turnIndex ?? 0),
        } satisfies AssistantChatMessage)
        break

      default:
        break
    }
  }

  flushToolBuffer()
  flushPendingThinking()

  // Mark the trailing tool group as active — it hasn't been closed by a
  // subsequent assistant/user message, so it may still receive new tool calls.
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'tool-group') {
      (messages[i] as ToolGroupChatMessage).isActive = true
      break
    }
    // Stop searching if an assistant message is found — the group was
    // properly flushed and is no longer the trailing group.
    // Note: user messages include pending/done types that don't flush tool
    // buffers, so only assistant messages are a reliable boundary.
    if (messages[i].type === 'assistant') break
  }

  return messages
}

// ---------- Hook ----------

interface ChatMessagesResult {
  messages: ChatMessage[]
  pendingMessages: UserChatMessage[]
}

/**
 * Transform flat NormalizedLogEntry[] into grouped ChatMessage[].
 * Frontend equivalent of the backend MessageRebuilder.
 * Pending messages are extracted and returned separately for bottom-pinned display.
 */
export function useChatMessages(logs: NormalizedLogEntry[]): ChatMessagesResult {
  return useMemo(() => {
    const all = rebuildMessages(logs)
    const messages: ChatMessage[] = []
    const pendingMessages: UserChatMessage[] = []
    for (const msg of all) {
      if (msg.type === 'user' && (msg.status === 'pending' || msg.status === 'done')) {
        pendingMessages.push(msg)
      } else {
        messages.push(msg)
      }
    }
    return { messages, pendingMessages }
  }, [logs])
}
