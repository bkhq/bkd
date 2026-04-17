// ---------- Claude JSON types (discriminated union) ----------

/** Top-level message envelope from Claude CLI stdout (stream-json format). */
export type ClaudeJson =
  | ClaudeSystem |
  ClaudeAssistant |
  ClaudeUser |
  ClaudeToolUse |
  ClaudeToolResult |
  ClaudeStreamEvent |
  ClaudeStreamEventWrapper |
  ClaudeResult |
  ClaudeError |
  ClaudeRateLimit |
  ClaudeInternalLifecycle

export interface ClaudeInternalLifecycle {
  type: 'queue-operation' | 'progress' | 'last-prompt'
  [key: string]: unknown
}

export interface ClaudeSystem {
  type: 'system'
  subtype?: string
  session_id?: string
  cwd?: string
  model?: string
  tools?: unknown[]
  apiKeySource?: string
  status?: string
  // session_state_changed carries the authoritative turn-over signal
  // ('idle' after the bg-agent do-while exits).
  state?: 'idle' | 'running' | 'requires_action' | string
  slash_commands?: string[]
  plugins?: Array<{ name: string, path: string }>
  agents?: string[]
  compact_metadata?: Record<string, unknown>
  output?: string
  hook_name?: string
  message?: string
  content?: string
  timestamp?: string
}

export interface ClaudeAssistant {
  type: 'assistant'
  message: ClaudeMessage
  session_id?: string
  uuid?: string
  timestamp?: string
}

export interface ClaudeUser {
  type: 'user'
  message: ClaudeMessage
  session_id?: string
  uuid?: string
  isSynthetic?: boolean
  isReplay?: boolean
  timestamp?: string
}

export interface ClaudeToolUse {
  type: 'tool_use'
  id?: string
  name?: string
  input?: Record<string, unknown>
  session_id?: string
  timestamp?: string
}

export interface ClaudeToolResult {
  type: 'tool_result'
  tool_use_id?: string
  content?: string | unknown[]
  is_error?: boolean
  session_id?: string
  timestamp?: string
}

export interface ClaudeStreamEvent {
  type:
    | 'content_block_delta' |
    'content_block_start' |
    'content_block_stop' |
    'message_start' |
    'message_delta' |
    'message_stop'
  index?: number
  delta?: {
    type?: string
    text?: string
    thinking?: string
    signature?: string
    citation?: unknown
  }
  content_block?: ClaudeContentItem
  message?: ClaudeMessage
  usage?: ClaudeUsage
  parent_tool_use_id?: string
  session_id?: string
  uuid?: string
  timestamp?: string
}

/** Wrapper format: `{"type":"stream_event","event":{...actual event...}}` */
export interface ClaudeStreamEventWrapper {
  type: 'stream_event'
  event: ClaudeStreamEvent
  session_id?: string
  parent_tool_use_id?: string | null
  uuid?: string
  timestamp?: string
}

export interface ClaudeResult {
  type: 'result'
  subtype?: string
  is_error?: boolean
  duration_ms?: number
  cost_usd?: number
  input_tokens?: number
  output_tokens?: number
  num_turns?: number
  session_id?: string
  result?: string
  errors?: unknown[]
  model_usage?: Record<string, { contextWindow?: number }>
  usage?: ClaudeUsage
  timestamp?: string
}

export interface ClaudeError {
  type: 'error'
  error?: { type?: string, message?: string }
  message?: string
  timestamp?: string
}

export interface ClaudeRateLimit {
  type: 'rate_limit'
  session_id?: string
  rate_limit_info?: Record<string, unknown>
  timestamp?: string
}

// ---------- Message / Content types ----------

export interface ClaudeMessage {
  id?: string
  role?: string
  model?: string
  content?: ClaudeContentItem[] | string
  stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal' | string
}

export type ClaudeContentItem =
  | { type: 'text', text: string, citations?: unknown[] | null } |
  { type: 'thinking', thinking: string } |
  { type: 'redacted_thinking', data: string } |
  {
    type: 'tool_use'
    id?: string
    name?: string
    input?: Record<string, unknown>
  } |
  {
    type: 'tool_result'
    tool_use_id?: string
    content?: string | unknown[]
    is_error?: boolean
  } |
  {
    type: 'server_tool_use'
    id: string
    name: string
    input?: unknown
    caller?: { type: string, tool_id?: string }
  } |
  {
    type: 'web_search_tool_result'
    tool_use_id: string
    content: unknown
  } |
  {
    type: 'web_fetch_tool_result'
    tool_use_id: string
    content: unknown
  } |
  {
    type: 'code_execution_tool_result'
    tool_use_id: string
    content: unknown
  } |
  {
    type: 'bash_code_execution_tool_result'
    tool_use_id: string
    content: unknown
  } |
  {
    type: 'text_editor_code_execution_tool_result'
    tool_use_id: string
    content: unknown
  } |
  {
    type: 'tool_search_tool_result'
    tool_use_id: string
    content: unknown
  } |
  {
    type: 'container_upload'
    [key: string]: unknown
  }

export interface ClaudeUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  server_tool_use?: {
    web_search_requests: number
    web_fetch_requests: number
  } | null
  cache_creation?: {
    ephemeral_1h_input_tokens: number
    ephemeral_5m_input_tokens: number
  } | null
  service_tier?: 'standard' | 'priority' | 'batch' | null
  inference_geo?: string | null
}

// ---------- Tool call info (for correlating tool_use → tool_result) ----------

export interface ToolCallInfo {
  toolName: string
  input: Record<string, unknown>
  toolCallId: string
}
