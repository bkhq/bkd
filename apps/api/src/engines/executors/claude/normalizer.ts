import type { NormalizedLogEntry } from '@/engines/types'
import {
  buildToolResultRaw,
  classifyToolAction,
  classifyToolKind,
  extractTextContent,
  generateToolContent,
  normalizeExecutionError,
  normalizeToolResultContent,
} from './normalizer-tool'
import type {
  ClaudeAssistant,
  ClaudeContentItem,
  ClaudeError,
  ClaudeJson,
  ClaudeRateLimit,
  ClaudeResult,
  ClaudeStreamEvent,
  ClaudeStreamEventWrapper,
  ClaudeSystem,
  ClaudeToolResult,
  ClaudeToolUse,
  ClaudeUser,
  ToolCallInfo,
} from './normalizer-types'

// Re-export for external consumers
export { classifyToolAction, extractTextContent } from './normalizer-tool'

// ---------- Normalizer ----------

export class ClaudeLogNormalizer {
  /** Map tool_use_id → structured info for follow-up tool_result replacement. */
  private readonly toolMap = new Map<string, ToolCallInfo>()
  /** Model name extracted from first assistant message. */
  private modelName: string | undefined
  /** Last assistant message text (used to deduplicate result.result text). */
  private lastAssistantMessage: string | undefined

  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    let data: ClaudeJson
    try {
      data = JSON.parse(rawLine)
    } catch {
      if (rawLine.trim()) {
        return { entryType: 'system-message', content: rawLine }
      }
      return null
    }

    switch (data.type) {
      case 'system':
        return this.parseSystem(data)
      case 'assistant':
        return this.parseAssistant(data)
      case 'user':
        return this.parseUser(data)
      case 'tool_use':
        return this.parseToolUse(data)
      case 'tool_result':
        return this.parseToolResult(data)
      case 'result':
        return this.parseResult(data)
      case 'error':
        return this.parseError(data)
      case 'stream_event':
        return this.parseStreamEventWrapper(data as ClaudeStreamEventWrapper)
      case 'content_block_delta':
      case 'content_block_start':
      case 'message_start':
      case 'message_delta':
      case 'message_stop':
      case 'content_block_stop':
        return this.parseStreamEvent(data)
      case 'rate_limit':
        return this.parseRateLimit(data)
      // Internal lifecycle types — no user-facing value
      case 'queue-operation':
      case 'progress':
      case 'last-prompt':
        return null
      default:
        return this.parseUnknown(data as Record<string, unknown>)
    }
  }

  // ---------- System ----------

  private parseSystem(data: ClaudeSystem): NormalizedLogEntry | null {
    switch (data.subtype) {
      case 'init':
        return {
          entryType: 'system-message',
          content: `Session started (${data.cwd ?? 'unknown dir'})`,
          timestamp: data.timestamp,
          metadata: {
            subtype: data.subtype,
            sessionId: data.session_id,
            cwd: data.cwd,
            model: data.model,
            slashCommands: Array.isArray(data.slash_commands) ? data.slash_commands : [],
            agents: Array.isArray(data.agents) ? data.agents : [],
            plugins: Array.isArray(data.plugins) ? data.plugins : [],
          },
        }
      case 'compact_boundary':
        return {
          entryType: 'system-message',
          content: 'Context compacted',
          timestamp: data.timestamp,
          metadata: {
            subtype: data.subtype,
            compactMetadata: data.compact_metadata,
          },
        }
      case 'task_started':
      case 'task_progress':
      case 'stop_hook_summary':
        // Suppress — no user-facing value
        return null
      case 'status':
        if (data.status) {
          return {
            entryType: 'system-message',
            content: data.status,
            timestamp: data.timestamp,
            metadata: { subtype: data.subtype },
          }
        }
        return null
      case 'hook_response':
        if (data.output) {
          return {
            entryType: 'system-message',
            content: data.output,
            timestamp: data.timestamp,
            metadata: { subtype: data.subtype, hookName: data.hook_name },
          }
        }
        return null
      default: {
        const msg = data.message ?? data.content ?? data.subtype ?? ''
        if (!msg) return null
        return {
          entryType: 'system-message',
          content: msg,
          timestamp: data.timestamp,
          metadata: data.subtype ? { subtype: data.subtype } : undefined,
        }
      }
    }
  }

  // ---------- Assistant ----------

  private parseAssistant(data: ClaudeAssistant): NormalizedLogEntry | NormalizedLogEntry[] | null {
    const entries: NormalizedLogEntry[] = []

    // Extract model name from first assistant message
    if (!this.modelName && data.message.model) {
      this.modelName = data.message.model
      entries.push({
        entryType: 'system-message',
        content: `System initialized with model: ${data.message.model}`,
        timestamp: data.timestamp,
      })
    }

    const contentBlocks = Array.isArray(data.message.content) ? data.message.content : null

    // Text content
    const text = extractTextContent(contentBlocks ?? data.message.content)
    if (text) {
      this.lastAssistantMessage = text
      entries.push({
        entryType: 'assistant-message',
        content: text,
        timestamp: data.timestamp,
        metadata: { messageId: data.message.id },
      })
    }

    // Thinking blocks (including redacted)
    if (contentBlocks) {
      for (const block of contentBlocks) {
        if (block.type === 'thinking' && block.thinking) {
          entries.push({
            entryType: 'thinking',
            content: block.thinking,
            timestamp: data.timestamp,
          })
        } else if (block.type === 'redacted_thinking') {
          entries.push({
            entryType: 'thinking',
            content: '[Thinking redacted]',
            timestamp: data.timestamp,
            metadata: { redacted: true },
          })
        }
      }
    }

    // Tool use blocks (client-side and server-side)
    if (contentBlocks) {
      for (const block of contentBlocks) {
        // Client-side tool_use
        if (block.type === 'tool_use' && block.name) {
          const input = block.input ?? {}
          const toolCallId = block.id ?? ''

          if (toolCallId) {
            this.toolMap.set(toolCallId, {
              toolName: block.name,
              input,
              toolCallId,
            })
          }

          entries.push({
            entryType: 'tool-use',
            content: generateToolContent(block.name, input),
            timestamp: data.timestamp,
            metadata: {
              messageId: data.message.id,
              toolName: block.name,
              input,
              toolCallId,
            },
            toolAction: classifyToolAction(block.name, input),
            toolDetail: {
              kind: classifyToolKind(block.name),
              toolName: block.name,
              toolCallId,
              isResult: false,
              raw: input,
            },
          })
        }

        // Server-side tool_use (web_search, web_fetch, code_execution, etc.)
        if (block.type === 'server_tool_use') {
          const input = (typeof block.input === 'object' && block.input !== null ? block.input : {}) as Record<string, unknown>
          const toolCallId = block.id

          this.toolMap.set(toolCallId, {
            toolName: block.name,
            input,
            toolCallId,
          })

          entries.push({
            entryType: 'tool-use',
            content: generateToolContent(block.name, input),
            timestamp: data.timestamp,
            metadata: {
              messageId: data.message.id,
              toolName: block.name,
              input,
              toolCallId,
              serverTool: true,
            },
            toolAction: classifyToolAction(block.name, input),
            toolDetail: {
              kind: classifyToolKind(block.name),
              toolName: block.name,
              toolCallId,
              isResult: false,
              raw: input,
            },
          })
        }

        // Server tool result blocks
        if (
          block.type === 'web_search_tool_result'
          || block.type === 'web_fetch_tool_result'
          || block.type === 'code_execution_tool_result'
          || block.type === 'bash_code_execution_tool_result'
          || block.type === 'text_editor_code_execution_tool_result'
          || block.type === 'tool_search_tool_result'
        ) {
          const toolUseId = block.tool_use_id
          const info = this.toolMap.get(toolUseId)
          if (info) this.toolMap.delete(toolUseId)

          const resultContent = this.extractServerToolResultContent(block.type, block.content)
          const isError = typeof block.content === 'object'
            && block.content !== null
            && 'type' in (block.content as Record<string, unknown>)
            && String((block.content as Record<string, unknown>).type).endsWith('_error')

          entries.push({
            entryType: isError ? 'error-message' : 'tool-use',
            content: resultContent,
            timestamp: data.timestamp,
            metadata: {
              toolCallId: toolUseId,
              toolName: info?.toolName,
              isResult: true,
              serverTool: true,
            },
            toolDetail: info
              ? {
                  kind: classifyToolKind(info.toolName),
                  toolName: info.toolName,
                  toolCallId: toolUseId,
                  isResult: true,
                  raw: buildToolResultRaw(info, resultContent, isError),
                }
              : undefined,
          })
        }
      }
    }

    if (entries.length === 0) return null
    return entries
  }

  // ---------- User ----------

  private parseUser(data: ClaudeUser): NormalizedLogEntry | NormalizedLogEntry[] | null {
    // Skip replay messages (historical context from --resume)
    if (data.isReplay) return null

    const contentBlocks = Array.isArray(data.message.content) ? data.message.content : null

    // Synthetic messages (injected by CLI, e.g. hook output)
    if (data.isSynthetic && contentBlocks) {
      const entries: NormalizedLogEntry[] = []
      for (const item of contentBlocks) {
        if (item.type === 'text' && item.text) {
          entries.push({
            entryType: 'system-message',
            content: item.text,
            timestamp: data.timestamp,
          })
        }
      }
      return entries.length > 0 ? entries : null
    }

    // Tool results embedded in user messages
    const toolResults = (contentBlocks ?? []).filter(
      (block): block is Extract<ClaudeContentItem, { type: 'tool_result' }> =>
        block.type === 'tool_result',
    )

    if (toolResults.length > 0) {
      const kept: NormalizedLogEntry[] = []

      for (const tr of toolResults) {
        const toolUseId = tr.tool_use_id ?? ''

        const info = toolUseId ? this.toolMap.get(toolUseId) : undefined
        if (info && toolUseId) this.toolMap.delete(toolUseId)
        const resultContent = normalizeToolResultContent(tr.content)

        kept.push({
          entryType: tr.is_error ? 'error-message' : 'tool-use',
          content: resultContent,
          timestamp: data.timestamp,
          metadata: {
            toolCallId: toolUseId,
            toolName: info?.toolName,
            isResult: true,
          },
          toolDetail: info ?
              {
                kind: classifyToolKind(info.toolName),
                toolName: info.toolName,
                toolCallId: toolUseId,
                isResult: true,
                raw: buildToolResultRaw(info, resultContent, tr.is_error),
              } :
            undefined,
        })
      }

      if (kept.length === 0) return null
      return kept
    }

    // Slash command output — only treat content wrapped in <local-command-stdout>
    const rawContent = typeof data.message.content === 'string' ? data.message.content : null
    if (rawContent) {
      if (rawContent.includes('<local-command-stdout>')) {
        const stripped = rawContent
          .replace(/^<local-command-stdout>\s*/, '')
          .replace(/\s*<\/local-command-stdout>\s*$/, '')
          .trim()
        if (stripped) {
          return {
            entryType: 'system-message',
            content: stripped,
            timestamp: data.timestamp,
            metadata: { subtype: 'command_output' },
          }
        }
      }
      // Non-command user message echoes → discard
      return null
    }

    return null
  }

  // ---------- Standalone tool_use / tool_result ----------

  private parseToolUse(data: ClaudeToolUse): NormalizedLogEntry | null {
    if (!data.name) return null

    const input = data.input ?? {}
    const toolCallId = data.id ?? ''

    if (toolCallId) {
      this.toolMap.set(toolCallId, { toolName: data.name, input, toolCallId })
    }

    return {
      entryType: 'tool-use',
      content: generateToolContent(data.name, input),
      timestamp: data.timestamp,
      metadata: { toolName: data.name, input, toolCallId },
      toolAction: classifyToolAction(data.name, input),
      toolDetail: {
        kind: classifyToolKind(data.name),
        toolName: data.name,
        toolCallId,
        isResult: false,
        raw: input,
      },
    }
  }

  private parseToolResult(data: ClaudeToolResult): NormalizedLogEntry | null {
    const toolUseId = data.tool_use_id ?? ''

    const info = toolUseId ? this.toolMap.get(toolUseId) : undefined
    if (info && toolUseId) this.toolMap.delete(toolUseId)
    const resultContent = normalizeToolResultContent(data.content)

    return {
      entryType: data.is_error ? 'error-message' : 'tool-use',
      content: resultContent,
      timestamp: data.timestamp,
      metadata: {
        toolCallId: toolUseId,
        toolName: info?.toolName,
        isResult: true,
      },
      toolDetail: info ?
          {
            kind: classifyToolKind(info.toolName),
            toolName: info.toolName,
            toolCallId: toolUseId,
            isResult: true,
            raw: buildToolResultRaw(info, resultContent, data.is_error),
          } :
        undefined,
    }
  }

  // ---------- Streaming events ----------

  /** Unwrap `{"type":"stream_event","event":{...}}` wrapper and delegate. */
  private parseStreamEventWrapper(data: ClaudeStreamEventWrapper): NormalizedLogEntry | null {
    if (!data.event) return null
    // Merge outer fields (session_id, parent_tool_use_id, uuid, timestamp)
    // into the inner event so downstream parsers see them.
    const inner: ClaudeStreamEvent = {
      ...data.event,
      session_id: data.event.session_id ?? data.session_id,
      parent_tool_use_id: data.event.parent_tool_use_id ?? data.parent_tool_use_id ?? undefined,
      uuid: data.event.uuid ?? data.uuid,
      timestamp: data.event.timestamp ?? data.timestamp,
    }
    return this.parseStreamEvent(inner)
  }

  private parseStreamEvent(data: ClaudeStreamEvent): NormalizedLogEntry | null {
    switch (data.type) {
      case 'content_block_delta':
        return this.parseContentBlockDelta(data)
      case 'message_start':
        return this.parseMessageStart(data)
      case 'message_delta':
        return this.parseMessageDelta(data)
      // content_block_start, content_block_stop, message_stop — no user-facing output
      default:
        return null
    }
  }

  private parseContentBlockDelta(_data: ClaudeStreamEvent): NormalizedLogEntry | null {
    // Ignore streaming deltas — complete assistant messages contain the full content.
    return null
  }

  private parseMessageStart(data: ClaudeStreamEvent): NormalizedLogEntry | null {
    if (data.message?.model && !this.modelName) {
      this.modelName = data.message.model
      return {
        entryType: 'system-message',
        content: `System initialized with model: ${data.message.model}`,
        timestamp: data.timestamp,
      }
    }
    return null
  }

  private parseMessageDelta(data: ClaudeStreamEvent): NormalizedLogEntry | null {
    // Emit token usage from message_delta if not from subagent
    if (!data.parent_tool_use_id && data.usage) {
      const input =
        (data.usage.input_tokens ?? 0)
        + (data.usage.cache_creation_input_tokens ?? 0)
        + (data.usage.cache_read_input_tokens ?? 0)
      const output = data.usage.output_tokens ?? 0
      if (input > 0 || output > 0) {
        const metadata: Record<string, unknown> = {
          inputTokens: input,
          outputTokens: output,
        }
        // Include enriched usage fields when present
        if (data.usage.service_tier) metadata.serviceTier = data.usage.service_tier
        if (data.usage.inference_geo) metadata.inferenceGeo = data.usage.inference_geo
        if (data.usage.server_tool_use) metadata.serverToolUse = data.usage.server_tool_use
        if (data.usage.cache_creation) metadata.cacheCreation = data.usage.cache_creation

        return {
          entryType: 'token-usage',
          content: `${input} input · ${output} output`,
          timestamp: data.timestamp,
          metadata,
        }
      }
    }
    return null
  }

  /** Extract human-readable content from server tool result blocks. */
  private extractServerToolResultContent(blockType: string, content: unknown): string {
    if (!content || typeof content !== 'object') return `${blockType}: (empty)`

    // Error result (all server tool errors share *_error type suffix)
    const contentObj = content as Record<string, unknown>
    if (typeof contentObj.type === 'string' && contentObj.type.endsWith('_error')) {
      return `Error: ${contentObj.error_code ?? contentObj.type}${contentObj.error_message ? ` — ${contentObj.error_message}` : ''}`
    }

    switch (blockType) {
      case 'web_search_tool_result':
        // Array of WebSearchResultBlock
        if (Array.isArray(content)) {
          return content
            .map((r: Record<string, unknown>) => r.title ?? r.url ?? '')
            .filter(Boolean)
            .join(', ') || 'Web search completed'
        }
        return 'Web search completed'

      case 'web_fetch_tool_result': {
        // WebFetchBlock — extract text from nested structure
        if ('page_content' in contentObj && typeof contentObj.page_content === 'string') {
          return contentObj.page_content.slice(0, 500)
        }
        if ('content' in contentObj) {
          const inner = contentObj.content
          if (typeof inner === 'string') return inner.slice(0, 500)
          if (typeof inner === 'object' && inner !== null) {
            const innerObj = inner as Record<string, unknown>
            // { type: 'web_fetch_result', content: "..." } or { page_content: "..." }
            if (typeof innerObj.page_content === 'string') return innerObj.page_content.slice(0, 500)
            if (typeof innerObj.content === 'string') return innerObj.content.slice(0, 500)
            return JSON.stringify(inner).slice(0, 500)
          }
        }
        return 'Web fetch completed'
      }

      case 'code_execution_tool_result':
      case 'bash_code_execution_tool_result': {
        // CodeExecutionResultBlock with stdout/stderr
        const stdout = contentObj.stdout ?? ''
        const stderr = contentObj.stderr ?? ''
        const rc = contentObj.return_code
        const parts: string[] = []
        if (stdout) parts.push(String(stdout).slice(0, 500))
        if (stderr) parts.push(`stderr: ${String(stderr).slice(0, 200)}`)
        if (rc !== undefined && rc !== 0) parts.push(`exit: ${rc}`)
        return parts.join('\n') || 'Code execution completed'
      }

      case 'text_editor_code_execution_tool_result':
        return 'Text editor operation completed'

      case 'tool_search_tool_result':
        return 'Tool search completed'

      default:
        return JSON.stringify(content).slice(0, 300)
    }
  }

  // ---------- Result ----------

  private parseResult(data: ClaudeResult): NormalizedLogEntry | NormalizedLogEntry[] {
    const entries: NormalizedLogEntry[] = []
    const isLogicalError = !!data.is_error || data.subtype !== 'success'

    const parts: string[] = []
    if (data.duration_ms) parts.push(`${(data.duration_ms / 1000).toFixed(1)}s`)
    if (data.input_tokens) parts.push(`${data.input_tokens} input`)
    if (data.output_tokens) parts.push(`${data.output_tokens} output`)
    if (data.cost_usd) parts.push(`$${data.cost_usd.toFixed(4)}`)

    let errorSummary: string | undefined
    let errorKind: string | undefined
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const first = data.errors[0]
      const rawError = typeof first === 'string' ? first : JSON.stringify(first)
      const normalized = normalizeExecutionError(rawError)
      errorSummary = normalized.summary
      errorKind = normalized.kind
    }

    if (isLogicalError) {
      parts.unshift(`Execution ${data.subtype ?? 'error'}`)
      if (errorSummary) parts.push(errorSummary)
    }

    entries.push({
      entryType: isLogicalError ? 'error-message' : 'system-message',
      content: parts.length ? parts.join(' · ') : '',
      timestamp: data.timestamp,
      metadata: {
        source: 'result',
        turnCompleted: true,
        resultSubtype: data.subtype,
        isError: isLogicalError,
        errorKind,
        error: errorSummary,
        sessionId: data.session_id,
        costUsd: data.cost_usd,
        inputTokens: data.input_tokens,
        outputTokens: data.output_tokens,
        duration: data.duration_ms,
        numTurns: data.num_turns,
        modelUsage: data.model_usage,
      },
    })

    // If result contains text that wasn't already emitted as assistant message,
    // emit it (same logic as vibe-kanban reference)
    if (
      data.subtype === 'success' &&
      typeof data.result === 'string' &&
      data.result.trim() &&
      (!this.lastAssistantMessage || !this.lastAssistantMessage.includes(data.result))
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

  // ---------- Error ----------

  private parseError(data: ClaudeError): NormalizedLogEntry {
    return {
      entryType: 'error-message',
      content: data.error?.message ?? data.message ?? 'Unknown error',
      timestamp: data.timestamp,
      metadata: { errorType: data.error?.type },
    }
  }

  // ---------- Rate limit ----------

  private parseRateLimit(data: ClaudeRateLimit): NormalizedLogEntry {
    return {
      entryType: 'system-message',
      content: 'Rate limit reached',
      timestamp: data.timestamp,
      metadata: {
        subtype: 'rate_limit',
        rateLimitInfo: data.rate_limit_info,
      },
    }
  }

  // ---------- Unknown ----------

  private parseUnknown(data: Record<string, unknown>): NormalizedLogEntry | null {
    const fallbackContent = (data.message ?? data.content ?? '') as string
    const fallbackStr =
      typeof fallbackContent === 'string' ? fallbackContent : JSON.stringify(fallbackContent)
    if (!fallbackStr.trim()) return null
    return {
      entryType: 'system-message',
      content: fallbackStr,
      timestamp: data.timestamp as string | undefined,
      metadata: { subtype: (data.type as string) ?? 'unknown' },
    }
  }
}
