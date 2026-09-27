import { classifyCommand } from '@/engines/logs'
import type { NormalizedLogEntry, TaskPlanItem, ToolAction } from '@/engines/types'

/**
 * Normalizer for Cursor CLI headless output
 * (`cursor-agent -p --output-format stream-json`).
 *
 * Events: `system/init`, `user` (prompt echo), `thinking` deltas closed by a
 * `completed`, whole `assistant` messages, `tool_call` started/completed with
 * the call under `tool_call.<name>ToolCall.{args,result}`, and a final `result`.
 */

// ---------- Wire types (only the fields read here) ----------

interface CursorLine {
  type: string
  subtype?: string
  session_id?: string
  model?: string
  cwd?: string
  text?: string
  message?: { content?: Array<{ type?: string, text?: string }> | string }
  model_call_id?: string
  call_id?: string
  tool_call?: Record<string, unknown>
  is_error?: boolean
  result?: string
  duration_ms?: number
  request_id?: string
  usage?: { inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number }
}

interface ToolCall {
  toolName: string
  input: Record<string, unknown>
}

type Rec = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : undefined)

// ---------- Tool classification ----------

function toolKind(toolName: string): string {
  switch (toolName) {
    case 'read':
      return 'file-read'
    case 'edit':
    case 'write':
    case 'delete':
      return 'file-edit'
    case 'shell':
      return 'command-run'
    case 'grep':
    case 'glob':
    case 'ls':
    case 'semSearch':
    case 'webSearch':
      return 'search'
    case 'webFetch':
      return 'web-fetch'
    case 'updateTodos':
      return 'task-plan'
    default:
      return 'tool'
  }
}

function todoItems(input: Rec): TaskPlanItem[] {
  const todos = Array.isArray(input.todos) ? input.todos : []
  return todos.flatMap((raw) => {
    const t = rec(raw)
    if (!t || typeof t.content !== 'string' || !t.content) return []
    return [{ content: t.content, status: typeof t.status === 'string' ? t.status : 'pending' }]
  })
}

function toolAction(toolName: string, input: Rec): ToolAction {
  switch (toolName) {
    case 'read':
      return { kind: 'file-read', path: str(input.path) }
    case 'edit':
    case 'write':
    case 'delete':
      return { kind: 'file-edit', path: str(input.path) }
    case 'shell': {
      const command = str(input.command)
      return { kind: 'command-run', command, category: classifyCommand(command) }
    }
    case 'grep':
      return { kind: 'search', query: str(input.pattern) }
    case 'glob':
      return { kind: 'search', query: str(input.globPattern) }
    case 'ls':
      return { kind: 'search', query: str(input.path ?? input.targetDirectory) }
    case 'semSearch':
    case 'webSearch':
      return { kind: 'search', query: str(input.query) }
    case 'webFetch':
      return { kind: 'web-fetch', url: str(input.url) }
    case 'updateTodos':
      return { kind: 'task-plan', items: todoItems(input) }
    default:
      return { kind: 'tool', toolName, arguments: input }
  }
}

function toolContent(toolName: string, input: Rec): string {
  const action = toolAction(toolName, input)
  switch (action.kind) {
    case 'file-read':
    case 'file-edit':
      return action.path || toolName
    case 'command-run':
      return action.command || toolName
    case 'search':
      return toolName === 'grep' && input.path ? `${action.query} in ${str(input.path)}` : action.query || toolName
    case 'web-fetch':
      return action.url || toolName
    case 'task-plan':
      return 'TODO list updated'
    default:
      return `Tool: ${toolName}`
  }
}

// ---------- Tool result decoding ----------

function grepText(success: Rec): string | undefined {
  const workspaces = rec(success.workspaceResults)
  if (!workspaces) return undefined
  const lines: string[] = []
  for (const ws of Object.values(workspaces)) {
    const matches = rec(rec(ws)?.content)?.matches
    if (!Array.isArray(matches)) continue
    for (const file of matches) {
      const f = rec(file)
      const hits = Array.isArray(f?.matches) ? f.matches : []
      for (const hit of hits) {
        const h = rec(hit)
        if (h) lines.push(`${str(f?.file)}:${str(h.lineNumber)}: ${str(h.content)}`)
      }
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No matches'
}

function shellText(success: Rec): string {
  const parts = [str(success.stdout), str(success.stderr)].filter(Boolean)
  const exitCode = typeof success.exitCode === 'number' ? success.exitCode : 0
  if (exitCode !== 0) parts.push(`[exit ${exitCode}]`)
  return parts.join('\n')
}

/** Pull the human-readable part out of a successful tool result. */
function decodeSuccess(toolName: string, success: Rec): string {
  switch (toolName) {
    case 'read':
      return str(success.content)
    case 'shell':
      return shellText(success)
    case 'edit':
    case 'write':
      return str(success.diffString || success.message)
    case 'grep':
      return grepText(success) ?? JSON.stringify(success)
    case 'glob':
      return Array.isArray(success.files) ? success.files.map(str).join('\n') : JSON.stringify(success)
    default:
      return typeof success.content === 'string' ? success.content : JSON.stringify(success)
  }
}

function decodeResult(toolName: string, result: Rec | undefined): { content: string, isError: boolean } {
  if (!result) return { content: '', isError: false }
  const success = rec(result.success)
  if (success) return { content: decodeSuccess(toolName, success), isError: false }
  // Anything else (`error`, `rejected`, ...) is a failure; show what it says.
  const [key, value] = Object.entries(result)[0] ?? ['error', undefined]
  const detail = rec(value)
  const text = str(detail?.message ?? detail?.error ?? (typeof value === 'string' ? value : ''))
  return { content: text || `${key}: ${JSON.stringify(value)}`, isError: true }
}

// ---------- Normalizer ----------

export class CursorLogNormalizer {
  /** call_id → call, so a completed event can be tied back to its tool. */
  private readonly toolCalls = new Map<string, ToolCall>()
  /** Thinking deltas of the block currently being streamed. */
  private thinking: string[] = []
  /** Whether assistant text was emitted this turn, so `result.result` is not repeated. */
  private sawAssistantText = false

  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    let data: CursorLine
    try {
      data = JSON.parse(rawLine) as CursorLine
    } catch {
      return rawLine.trim() ? { entryType: 'system-message', content: rawLine } : null
    }
    if (!data || typeof data !== 'object') return null

    switch (data.type) {
      case 'system':
        return this.parseSystem(data)
      case 'thinking':
        return this.parseThinking(data)
      case 'assistant':
        return this.parseAssistant(data)
      case 'tool_call':
        return this.parseToolCall(data)
      case 'result':
        return this.parseResult(data)
      default:
        return null
    }
  }

  private parseSystem(data: CursorLine): NormalizedLogEntry | null {
    if (data.subtype !== 'init') return null
    this.sawAssistantText = false
    return {
      entryType: 'system-message',
      content: `Session started (${data.cwd ?? 'unknown dir'})`,
      metadata: {
        subtype: 'init',
        sessionId: data.session_id,
        cwd: data.cwd,
        model: data.model,
      },
    }
  }

  private parseThinking(data: CursorLine): NormalizedLogEntry | null {
    if (data.subtype === 'delta') {
      if (data.text) this.thinking.push(data.text)
      return null
    }
    if (data.subtype !== 'completed') return null
    const content = this.thinking.join('')
    this.thinking = []
    return content.trim() ? { entryType: 'thinking', content } : null
  }

  private parseAssistant(data: CursorLine): NormalizedLogEntry[] | null {
    const content = data.message?.content
    const texts = typeof content === 'string'
      ? [content]
      : Array.isArray(content) ? content.filter(b => b.type === 'text' && b.text).map(b => b.text!) : []
    if (texts.length === 0) return null
    this.sawAssistantText = true
    return texts.map(text => ({
      entryType: 'assistant-message',
      content: text,
      metadata: data.model_call_id ? { messageId: data.model_call_id } : undefined,
    }))
  }

  private parseToolCall(data: CursorLine): NormalizedLogEntry | null {
    const toolCallId = data.call_id ?? ''
    const variant = Object.keys(data.tool_call ?? {}).find(k => k.endsWith('ToolCall'))
    if (!variant) return null
    const toolName = variant.slice(0, -'ToolCall'.length)
    const body = rec(data.tool_call![variant]) ?? {}
    const input = rec(body.args) ?? {}

    if (data.subtype === 'started') {
      if (toolCallId) this.toolCalls.set(toolCallId, { toolName, input })
      return {
        entryType: 'tool-use',
        content: toolContent(toolName, input),
        metadata: { toolName, input, toolCallId },
        toolAction: toolAction(toolName, input),
        toolDetail: { kind: toolKind(toolName), toolName, toolCallId, isResult: false, raw: input },
      }
    }
    if (data.subtype !== 'completed') return null

    const call = this.toolCalls.get(toolCallId) ?? { toolName, input }
    this.toolCalls.delete(toolCallId)
    const { content, isError } = decodeResult(toolName, rec(body.result))
    return {
      entryType: isError ? 'error-message' : 'tool-use',
      content,
      metadata: { toolCallId, toolName, isResult: true },
      toolDetail: {
        kind: toolKind(toolName),
        toolName,
        toolCallId,
        isResult: true,
        raw: { toolName, input: call.input, result: content, isError },
      },
    }
  }

  private parseResult(data: CursorLine): NormalizedLogEntry[] {
    const isError = data.is_error === true || data.subtype !== 'success'
    const usage = data.usage
    const inputTokens = usage
      ? (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      : undefined
    const outputTokens = usage?.outputTokens

    const parts: string[] = []
    if (isError) parts.push(`Execution ${data.subtype ?? 'error'}`)
    if (data.duration_ms) parts.push(`${(data.duration_ms / 1000).toFixed(1)}s`)
    if (inputTokens) parts.push(`${inputTokens} input`)
    if (outputTokens) parts.push(`${outputTokens} output`)
    if (isError && data.result) parts.push(data.result)

    const entries: NormalizedLogEntry[] = [{
      entryType: isError ? 'error-message' : 'system-message',
      content: parts.join(' · '),
      metadata: {
        source: 'result',
        turnCompleted: true,
        resultSubtype: data.subtype,
        isError,
        ...(isError && data.result ? { error: data.result } : {}),
        sessionId: data.session_id,
        requestId: data.request_id,
        inputTokens,
        outputTokens,
        duration: data.duration_ms,
      },
    }]

    // `result.result` concatenates every assistant text of the turn; only
    // show it when none of them came through as assistant events.
    if (!isError && !this.sawAssistantText && typeof data.result === 'string' && data.result.trim()) {
      entries.push({ entryType: 'assistant-message', content: data.result, metadata: { source: 'result' } })
    }
    this.sawAssistantText = false
    return entries
  }
}
