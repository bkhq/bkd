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
import { useMemo, useState } from 'react'

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

// A failed tool result arrives as `error-message` carrying the result flag.
function isToolUseResult(entry: NormalizedLogEntry): boolean {
  return (entry.entryType === 'tool-use' || entry.entryType === 'error-message') && hasResultFlag(entry)
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

function isAgentDispatch(entry: NormalizedLogEntry): boolean {
  const kind = entry.toolDetail?.kind
  const toolName = entry.toolDetail?.toolName ?? entry.metadata?.toolName
  return kind === 'agent' || kind === 'task' || toolName === 'Agent' || toolName === 'Task'
}

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
  /** Index in `rawEntries` of each entry of `entries`. */
  rawIndex: number[]
  subagentThreads: Map<string, SubagentThread>
} {
  const entries: NormalizedLogEntry[] = []
  const rawIndex: number[] = []
  const inner = new Map<string, NormalizedLogEntry[]>()
  const status = new Map<string, SubagentStatus>()

  for (let r = 0; r < rawEntries.length; r++) {
    const entry = rawEntries[r]
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
    rawIndex.push(r)
  }

  const subagentThreads = new Map<string, SubagentThread>()
  for (const callId of new Set([...inner.keys(), ...status.keys()])) {
    subagentThreads.set(
      callId,
      buildSubagentThread(callId, inner.get(callId) ?? [], status.get(callId) ?? {}),
    )
  }
  return { entries, rawIndex, subagentThreads }
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

/**
 * A point where the entry list can be cut: everything before it groups into
 * the same messages whether or not the rest is there.
 */
interface Checkpoint {
  /** Index of the first entry after the cut. */
  entryIndex: number
  /** Messages produced by the entries before the cut. */
  messageCount: number
  /** Fallback-id counter at the cut. */
  seq: number
  /** First command before the cut still waiting for its output, or -1. */
  openCommand: number
}

interface BuildResult {
  /** Grouped messages, the trailing tool group not yet marked active. */
  messages: ChatMessage[]
  checkpoints: Checkpoint[]
}

/** What an entry is tied to elsewhere in the list: a tool call, or a turn's duration. */
function linkKeys(entry: NormalizedLogEntry): string[] {
  const keys: string[] = []
  const callId = toolCallIdOf(entry)
  if (callId) keys.push(`c:${callId}`)
  const attribution = subagentOf(entry)
  if (attribution) keys.push(`c:${attribution.toolCallId}`)
  if (
    entry.entryType === 'assistant-message'
    || (entry.entryType === 'system-message' && typeof entry.metadata?.duration === 'number')
  ) {
    keys.push(`t:${entry.turnIndex ?? 0}`)
  }
  return keys
}

function isCommandOutput(entry: NormalizedLogEntry): boolean {
  return entry.entryType === 'system-message' && entry.metadata?.subtype === 'command_output'
}

export function rebuildMessages(rawEntries: NormalizedLogEntry[]): ChatMessage[] {
  return markActiveToolGroup(buildMessages(rawEntries, 0).messages)
}

/**
 * Mark the trailing tool group as active — it hasn't been closed by a
 * subsequent assistant/user message, so it may still receive new tool calls.
 * The group is copied, so `messages` may hold shared objects.
 */
function markActiveToolGroup(messages: ChatMessage[]): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type === 'tool-group') {
      const marked = [...messages]
      marked[i] = { ...message, isActive: true }
      return marked
    }
    // Stop searching if an assistant message is found — the group was
    // properly flushed and is no longer the trailing group.
    // Note: user messages include pending/done types that don't flush tool
    // buffers, so only assistant messages are a reliable boundary.
    if (message.type === 'assistant') break
  }
  return messages
}

function buildMessages(rawEntries: NormalizedLogEntry[], startSeq: number): BuildResult {
  // Subagent turns are nested under the tool call that dispatched them, so
  // they must not take part in main-timeline grouping.
  const { entries, rawIndex, subagentThreads } = partitionSubagents(rawEntries)

  // Local counter — avoids module-level singleton race when multiple
  // components call useChatMessages concurrently.
  let seq = startSeq
  const nextId = (prefix: string) => `${prefix}-${++seq}`

  // Last raw index each link is seen at: a cut is only safe once every link
  // opened before it has closed.
  const lastSeen = new Map<string, number>()
  for (let r = 0; r < rawEntries.length; r++) {
    for (const key of linkKeys(rawEntries[r])) lastSeen.set(key, r)
  }
  const checkpoints: Checkpoint[] = []
  let linkedUntil = -1
  let swept = 0
  let openCommand = -1

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

  /** Record a checkpoint before main-timeline entry `i` when nothing before it reaches past it. */
  function checkpointBefore(i: number): void {
    const cut = rawIndex[i]
    for (; swept < cut; swept++) {
      for (const key of linkKeys(rawEntries[swept])) {
        linkedUntil = Math.max(linkedUntil, lastSeen.get(key)!)
      }
    }
    if (cut > 0 && linkedUntil < cut) {
      checkpoints.push({ entryIndex: cut, messageCount: messages.length, seq, openCommand })
    }
  }

  function buildToolGroup(items: ToolGroupItem[], description?: string): ToolGroupChatMessage {
    const withSubagents = items.map((item) => {
      // Background Bash/Monitor tasks emit task_* events too; only agent dispatches own a thread.
      if (!isAgentDispatch(item.action)) return item
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
    if (entry.entryType === 'user-message' || entry.entryType === 'assistant-message') checkpointBefore(i)

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
            linkedUntil = Math.max(linkedUntil, rawIndex[outputIdx])
          } else if (openCommand < 0) {
            openCommand = rawIndex[i]
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

  return { messages, checkpoints }
}

// ---------- Incremental rebuild ----------

/**
 * Groups a growing entry list without regrouping what did not change: after an
 * update it restarts from the last checkpoint before the first changed entry,
 * so the messages before it are the same objects as last time. The result
 * always equals `rebuildMessages(entries)`.
 */
export class ChatMessageBuilder {
  private entries: NormalizedLogEntry[] = []
  private messages: ChatMessage[] = []
  private checkpoints: Checkpoint[] = []
  /** First index each link is seen at, for the entries of the last update. */
  private firstSeen = new Map<string, number>()

  update(entries: NormalizedLogEntry[]): ChatMessage[] {
    const previous = this.entries
    let same = 0
    const limit = Math.min(previous.length, entries.length)
    while (same < limit && previous[same] === entries[same]) same++

    // Entries past the unchanged part are regrouped; forget where their links were.
    if (same < previous.length) {
      for (const [key, index] of this.firstSeen) {
        if (index >= same) this.firstSeen.delete(key)
      }
    }

    const start = this.restartPoint(entries, same)
    const built = buildMessages(start.entryIndex > 0 ? entries.slice(start.entryIndex) : entries, start.seq)

    this.messages = start.entryIndex > 0
      ? [...this.messages.slice(0, start.messageCount), ...built.messages]
      : built.messages
    this.checkpoints = [
      ...this.checkpoints.filter(c => c.entryIndex <= start.entryIndex),
      ...built.checkpoints.map(c => ({
        entryIndex: c.entryIndex + start.entryIndex,
        messageCount: c.messageCount + start.messageCount,
        seq: c.seq,
        openCommand: start.openCommand >= 0
          ? start.openCommand
          : c.openCommand >= 0 ? c.openCommand + start.entryIndex : -1,
      })),
    ]
    for (let i = start.entryIndex; i < entries.length; i++) {
      for (const key of linkKeys(entries[i])) {
        if (!this.firstSeen.has(key)) this.firstSeen.set(key, i)
      }
    }
    this.entries = entries

    return markActiveToolGroup(this.messages)
  }

  /** Latest checkpoint at or before `same` that nothing after it links back across. */
  private restartPoint(entries: NormalizedLogEntry[], same: number): Checkpoint {
    const origin: Checkpoint = { entryIndex: 0, messageCount: 0, seq: 0, openCommand: -1 }
    let candidates = this.checkpoints.filter(c => c.entryIndex <= same)
    let scanned = entries.length
    let hasCommandOutput = false
    let earliestLink = Number.POSITIVE_INFINITY

    while (candidates.length > 0) {
      const checkpoint = candidates.at(-1)!
      for (let i = scanned - 1; i >= checkpoint.entryIndex; i--) {
        if (isCommandOutput(entries[i])) hasCommandOutput = true
        for (const key of linkKeys(entries[i])) {
          const first = this.firstSeen.get(key)
          if (first !== undefined) earliestLink = Math.min(earliestLink, first)
        }
      }
      scanned = checkpoint.entryIndex

      // The cut must sit at or before everything the rest links back to.
      let bound = earliestLink
      if (hasCommandOutput && checkpoint.openCommand >= 0) bound = Math.min(bound, checkpoint.openCommand)
      if (bound >= checkpoint.entryIndex) return checkpoint
      candidates = candidates.filter(c => c.entryIndex <= bound)
    }
    return origin
  }
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
  const [builder] = useState(() => new ChatMessageBuilder())
  return useMemo(() => {
    const all = builder.update(logs)
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
  }, [builder, logs])
}
