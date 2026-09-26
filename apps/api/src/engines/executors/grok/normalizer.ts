import { classifyCommand } from '@/engines/logs'
import type { NormalizedLogEntry, TaskPlanItem, ToolAction } from '@/engines/types'

/**
 * Normalizer for Grok Build headless output
 * (`grok -p ... --output-format streaming-messages-json`).
 *
 * The stream uses the Anthropic Messages wire shape — `system/init`,
 * `assistant`, `user` (tool results), `stream_event`, `result` — but Grok's
 * own tool set (`read_file`, `search_replace`, `run_terminal_command`, ...),
 * and every tool result is a JSON string with a typed payload
 * (`{"type":"ReadFile","FileContent":{...}}`) that is decoded here.
 */

// ---------- Wire types (only the fields read here) ----------

interface GrokContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface GrokUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface GrokLine {
  type: string
  subtype?: string
  session_id?: string
  model?: string
  cwd?: string
  slash_commands?: unknown
  message?: { id?: string, model?: string, content?: GrokContentBlock[] | string }
  event?: { type?: string, usage?: GrokUsage }
  parent_tool_use_id?: string | null
  is_error?: boolean
  result?: string
  duration_ms?: number
  num_turns?: number
  total_cost_usd?: number
  usage?: GrokUsage
  modelUsage?: Record<string, unknown>
  timestamp?: string
}

interface ToolCall {
  toolName: string
  input: Record<string, unknown>
}

// ---------- Tool classification ----------

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

function toolKind(toolName: string): string {
  switch (toolName) {
    case 'read_file':
      return 'file-read'
    case 'write':
    case 'search_replace':
      return 'file-edit'
    case 'run_terminal_command':
      return 'command-run'
    case 'grep':
    case 'list_dir':
    case 'web_search':
      return 'search'
    case 'web_fetch':
      return 'web-fetch'
    case 'spawn_subagent':
      return 'agent'
    case 'todo_write':
      return 'task-plan'
    default:
      return 'tool'
  }
}

function todoItems(input: Record<string, unknown>): TaskPlanItem[] {
  const todos = Array.isArray(input.todos) ? input.todos : []
  return todos.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) return []
    const t = raw as Record<string, unknown>
    if (typeof t.content !== 'string' || !t.content) return []
    return [{ content: t.content, status: typeof t.status === 'string' ? t.status : 'pending' }]
  })
}

function toolAction(toolName: string, input: Record<string, unknown>): ToolAction {
  switch (toolName) {
    case 'read_file':
      return { kind: 'file-read', path: str(input.target_file ?? input.file_path) }
    case 'write':
    case 'search_replace':
      return { kind: 'file-edit', path: str(input.file_path ?? input.target_file) }
    case 'run_terminal_command': {
      const command = str(input.command)
      return { kind: 'command-run', command, category: classifyCommand(command) }
    }
    case 'grep':
    case 'web_search':
      return { kind: 'search', query: str(input.pattern ?? input.query) }
    case 'list_dir':
      return { kind: 'search', query: str(input.target_directory ?? input.path) }
    case 'web_fetch':
      return { kind: 'web-fetch', url: str(input.url) }
    case 'spawn_subagent': {
      const description = typeof input.description === 'string' ? input.description : undefined
      const prompt = typeof input.prompt === 'string' ? input.prompt : undefined
      return {
        kind: 'agent',
        ...(description !== undefined ? { description } : {}),
        ...(prompt !== undefined ? { prompt } : {}),
      }
    }
    case 'todo_write':
      return { kind: 'task-plan', items: todoItems(input) }
    default:
      return { kind: 'tool', toolName, arguments: input }
  }
}

function toolContent(toolName: string, input: Record<string, unknown>): string {
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
    case 'agent':
      return action.description ?? action.prompt ?? 'Subagent'
    case 'task-plan':
      return 'TODO list updated'
    default:
      return `Tool: ${toolName}`
  }
}

// ---------- Tool result decoding ----------

function rawResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : typeof part === 'string' ? part : JSON.stringify(part)))
      .join('\n')
  }
  return JSON.stringify(content ?? '')
}

function grepText(payload: Record<string, unknown>): string | undefined {
  if (!Array.isArray(payload.file_matches)) return undefined
  const lines: string[] = []
  for (const file of payload.file_matches as Array<Record<string, unknown>>) {
    const matches = Array.isArray(file.matches) ? (file.matches as Array<Record<string, unknown>>) : []
    for (const m of matches) lines.push(`${str(file.path)}:${str(m.line_number)}: ${str(m.content)}`)
  }
  return lines.length > 0 ? lines.join('\n') : 'No matches'
}

/** Pull the human-readable part out of a typed Grok tool result payload. */
function decodeResultPayload(payload: Record<string, unknown>): string | undefined {
  const inner = (key: string) => (payload[key] && typeof payload[key] === 'object'
    ? payload[key] as Record<string, unknown>
    : undefined)

  switch (payload.type) {
    case 'ReadFile': {
      const file = inner('FileContent')
      return typeof file?.raw_output === 'string' ? file.raw_output : undefined
    }
    case 'ListDir':
      return typeof inner('Content')?.content === 'string' ? inner('Content')!.content as string : undefined
    case 'GrepSearch':
      return grepText(payload)
    case 'SearchReplace': {
      const edits = inner('EditsApplied')
      return typeof edits?.tool_output_for_prompt === 'string' ? edits.tool_output_for_prompt : undefined
    }
    case 'Bash':
      return typeof payload.output_for_prompt === 'string' ? payload.output_for_prompt : undefined
    case 'Todo': {
      const todos = inner('TodosUpdated')
      return typeof todos?.summary_for_prompt === 'string' ? todos.summary_for_prompt : undefined
    }
    default:
      return undefined
  }
}

function decodeToolResult(content: unknown): string {
  const raw = rawResultText(content)
  if (!raw.startsWith('{')) return raw
  try {
    const payload = JSON.parse(raw) as unknown
    if (payload && typeof payload === 'object') {
      return decodeResultPayload(payload as Record<string, unknown>) ?? raw
    }
  } catch {
    // Not JSON after all — show it as-is
  }
  return raw
}

// ---------- Normalizer ----------

export class GrokLogNormalizer {
  /** tool_use id → call, so a result can be tied back to its tool. */
  private readonly toolCalls = new Map<string, ToolCall>()
  /** Last assistant text, to avoid repeating it from `result.result`. */
  private lastAssistantText: string | undefined

  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    let data: GrokLine
    try {
      data = JSON.parse(rawLine) as GrokLine
    } catch {
      return rawLine.trim() ? { entryType: 'system-message', content: rawLine } : null
    }
    if (!data || typeof data !== 'object') return null

    switch (data.type) {
      case 'system':
        return this.parseSystem(data)
      case 'assistant':
        return this.parseAssistant(data)
      case 'user':
        return this.parseUser(data)
      case 'stream_event':
        return this.parseStreamEvent(data)
      case 'result':
        return this.parseResult(data)
      case 'error':
        return {
          entryType: 'error-message',
          content: str((data as { message?: unknown }).message) || 'Unknown error',
          timestamp: data.timestamp,
        }
      default:
        return null
    }
  }

  private parseSystem(data: GrokLine): NormalizedLogEntry | null {
    if (data.subtype === 'init') {
      return {
        entryType: 'system-message',
        content: `Session started (${data.cwd ?? 'unknown dir'})`,
        timestamp: data.timestamp,
        metadata: {
          subtype: 'init',
          sessionId: data.session_id,
          cwd: data.cwd,
          model: data.model,
          slashCommands: Array.isArray(data.slash_commands) ? data.slash_commands : [],
        },
      }
    }
    if (data.subtype === 'compact_boundary') {
      return {
        entryType: 'system-message',
        content: 'Context compacted',
        timestamp: data.timestamp,
        metadata: { subtype: data.subtype },
      }
    }
    return null
  }

  private parseAssistant(data: GrokLine): NormalizedLogEntry[] | null {
    const message = data.message
    if (!message) return null
    const blocks = Array.isArray(message.content) ? message.content : []
    const entries: NormalizedLogEntry[] = []

    if (typeof message.content === 'string' && message.content) {
      blocks.push({ type: 'text', text: message.content })
    }

    // Emit in block order: thinking → text → tool calls, as the model produced them.
    for (const block of blocks) {
      if (block.type === 'thinking' && block.thinking) {
        entries.push({ entryType: 'thinking', content: block.thinking, timestamp: data.timestamp })
        continue
      }
      if (block.type === 'text' && block.text) {
        this.lastAssistantText = block.text
        entries.push({
          entryType: 'assistant-message',
          content: block.text,
          timestamp: data.timestamp,
          metadata: { messageId: message.id },
        })
        continue
      }
      if (block.type !== 'tool_use' || !block.name) continue
      const input = block.input ?? {}
      const toolCallId = block.id ?? ''
      if (toolCallId) this.toolCalls.set(toolCallId, { toolName: block.name, input })
      entries.push({
        entryType: 'tool-use',
        content: toolContent(block.name, input),
        timestamp: data.timestamp,
        metadata: { messageId: message.id, toolName: block.name, input, toolCallId },
        toolAction: toolAction(block.name, input),
        toolDetail: {
          kind: toolKind(block.name),
          toolName: block.name,
          toolCallId,
          isResult: false,
          raw: input,
        },
      })
    }

    return entries.length > 0 ? entries : null
  }

  private parseUser(data: GrokLine): NormalizedLogEntry[] | null {
    const blocks = Array.isArray(data.message?.content) ? data.message.content : []
    const entries: NormalizedLogEntry[] = []

    for (const block of blocks) {
      if (block.type !== 'tool_result') continue
      const toolCallId = block.tool_use_id ?? ''
      const call = toolCallId ? this.toolCalls.get(toolCallId) : undefined
      if (call) this.toolCalls.delete(toolCallId)
      const content = decodeToolResult(block.content)
      const isError = block.is_error === true

      entries.push({
        entryType: isError ? 'error-message' : 'tool-use',
        content,
        timestamp: data.timestamp,
        metadata: { toolCallId, toolName: call?.toolName, isResult: true },
        toolDetail: call
          ? {
              kind: toolKind(call.toolName),
              toolName: call.toolName,
              toolCallId,
              isResult: true,
              raw: { toolName: call.toolName, input: call.input, result: content, isError },
            }
          : undefined,
      })
    }

    return entries.length > 0 ? entries : null
  }

  /** Only `message_delta` matters: its usage feeds the live context meter. */
  private parseStreamEvent(data: GrokLine): NormalizedLogEntry | null {
    const event = data.event
    if (event?.type !== 'message_delta' || !event.usage || data.parent_tool_use_id) return null
    const input = (event.usage.input_tokens ?? 0)
      + (event.usage.cache_read_input_tokens ?? 0)
      + (event.usage.cache_creation_input_tokens ?? 0)
    const output = event.usage.output_tokens ?? 0
    if (input === 0 && output === 0) return null
    return {
      entryType: 'token-usage',
      content: `${input} input · ${output} output`,
      timestamp: data.timestamp,
      metadata: { inputTokens: input, outputTokens: output },
    }
  }

  private parseResult(data: GrokLine): NormalizedLogEntry[] {
    const isError = data.is_error === true || data.subtype !== 'success'
    const usage = data.usage
    const inputTokens = usage
      ? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
      : undefined
    const outputTokens = usage?.output_tokens
    const costUsd = data.total_cost_usd

    const parts: string[] = []
    if (isError) parts.push(`Execution ${data.subtype ?? 'error'}`)
    if (data.duration_ms) parts.push(`${(data.duration_ms / 1000).toFixed(1)}s`)
    if (inputTokens) parts.push(`${inputTokens} input`)
    if (outputTokens) parts.push(`${outputTokens} output`)
    if (costUsd) parts.push(`$${costUsd.toFixed(4)}`)
    if (isError && data.result) parts.push(data.result)

    const entries: NormalizedLogEntry[] = [{
      entryType: isError ? 'error-message' : 'system-message',
      content: parts.join(' · '),
      timestamp: data.timestamp,
      metadata: {
        source: 'result',
        turnCompleted: true,
        resultSubtype: data.subtype,
        isError,
        ...(isError && data.result ? { error: data.result } : {}),
        sessionId: data.session_id,
        costUsd,
        inputTokens,
        outputTokens,
        duration: data.duration_ms,
        numTurns: data.num_turns,
        modelUsage: data.modelUsage,
      },
    }]

    if (
      !isError
      && typeof data.result === 'string'
      && data.result.trim()
      && !this.lastAssistantText?.includes(data.result)
    ) {
      entries.push({
        entryType: 'assistant-message',
        content: data.result,
        timestamp: data.timestamp,
        metadata: { source: 'result' },
      })
    }

    return entries
  }
}
