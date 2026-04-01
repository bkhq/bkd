import { classifyCommand } from '@/engines/logs'
import type { NormalizedLogEntry, ToolAction } from '@/engines/types'

// ---------- Types for Codex event protocol ----------

/**
 * Codex app-server uses standard JSON-RPC v2 notifications:
 *   { method: "item/agentMessage/delta", params: { threadId, turnId, itemId, delta } }
 *   { method: "item/started", params: { item: ThreadItem, threadId, turnId } }
 *   { method: "item/completed", params: { item: ThreadItem, threadId, turnId } }
 *   { method: "turn/started", params: { threadId, turn: Turn } }
 *   { method: "turn/completed", params: { threadId, turn: Turn } }
 *
 * The `codex/event/*` format only exists in mcp-server mode (not used here).
 */

// ---------- Stateful normalizer ----------

/**
 * Stateful Codex log normalizer for the app-server v2 JSON-RPC protocol.
 */
export class CodexLogNormalizer {
  private assistantText = ''
  private thinkingText = ''

  /**
   * Parse a single stdout line and return normalized log entries.
   * Returns null for lines that should be skipped.
   */
  parse(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    const now = new Date().toISOString()

    let data: Record<string, unknown>
    try {
      data = JSON.parse(rawLine)
    } catch {
      // Non-JSON — treat as plain text system message
      if (rawLine.trim()) {
        return {
          entryType: 'system-message',
          content: rawLine,
          timestamp: now,
        }
      }
      return null
    }

    const method = data.method as string | undefined

    // -- Handle JSON-RPC responses (session ID / model params extraction) --
    if ('id' in data && 'result' in data && !method) {
      return this.handleResponse(data, now)
    }

    // -- No method field — not a notification we handle --
    if (!method) return null

    // -- Standard v2 JSON-RPC notifications (primary path for app-server) --
    switch (method) {
      case 'item/agentMessage/delta':
        return this.handleAgentMessageDelta(data, now)

      case 'item/started':
        return this.handleItemStarted(data, now)

      case 'item/completed':
        return this.handleItemCompleted(data, now)

      case 'item/commandExecution/outputDelta':
        return this.handleCommandOutputDelta(data, now)

      case 'item/fileChange/outputDelta':
        return this.handleFileChangeOutputDelta(data, now)

      case 'turn/started':
        return this.handleTurnStarted(data, now)

      case 'turn/completed':
        return this.handleTurnCompleted(data, now)

      case 'thread/started':
        return this.handleThreadStarted(data, now)

      case 'thread/status/changed':
        return this.handleThreadStatusChanged(data, now)

      case 'error':
        return this.handleError(data, now)

      case 'item/reasoning/textDelta':
        return this.handleReasoningTextDelta(data, now)

      case 'item/reasoning/summaryTextDelta':
        return this.handleReasoningSummaryTextDelta(data, now)

      case 'item/reasoning/summaryPartAdded':
        return null // Section break — reset state handled via next delta

      case 'item/plan/delta':
        return this.handlePlanDelta(data, now)

      case 'item/mcpToolCall/progress':
        return null // Progress updates — no actionable data yet

      case 'model/rerouted': {
        const p = (data.params ?? {}) as Record<string, unknown>
        return {
          entryType: 'system-message',
          content: `Model rerouted from ${p.fromModel ?? ''} to ${p.toModel ?? ''}`,
          timestamp: now,
        }
      }

      case 'thread/compacted':
        return { entryType: 'system-message', content: 'Context compacted', timestamp: now }

      case 'thread/tokenUsage/updated': {
        const p = (data.params ?? {}) as Record<string, unknown>
        const usage = (p.usage ?? {}) as Record<string, unknown>
        const totalTokens = (usage.inputTokens as number ?? 0) + (usage.outputTokens as number ?? 0)
        const contextWindow = usage.contextWindow as number | undefined
        if (!totalTokens) return null
        return {
          entryType: 'token-usage',
          content: `Tokens: ${totalTokens}${contextWindow ? ` / Context: ${contextWindow}` : ''}`,
          timestamp: now,
          metadata: {
            totalTokens,
            ...(contextWindow != null && { contextWindow }),
            inputTokens: usage.inputTokens as number | undefined,
            outputTokens: usage.outputTokens as number | undefined,
          },
        }
      }

      default:
        return null
    }
  }

  // ---------- v2 notification handlers ----------

  /**
   * Handle `item/agentMessage/delta` — streaming assistant message text.
   * Wire format: { method: "item/agentMessage/delta", params: { threadId, turnId, itemId, delta } }
   */
  private handleAgentMessageDelta(data: Record<string, unknown>, now: string): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    this.thinkingText = ''
    this.assistantText += delta
    return {
      entryType: 'assistant-message',
      content: this.assistantText,
      timestamp: now,
      metadata: { streaming: true },
    }
  }

  /**
   * Handle `item/reasoning/textDelta` — streaming reasoning content.
   * Wire format: { method: "item/reasoning/textDelta", params: { threadId, turnId, itemId, delta, contentIndex } }
   */
  private handleReasoningTextDelta(data: Record<string, unknown>, now: string): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    this.assistantText = ''
    this.thinkingText += delta
    return {
      entryType: 'thinking',
      content: this.thinkingText,
      timestamp: now,
      metadata: { streaming: true },
    }
  }

  /**
   * Handle `item/reasoning/summaryTextDelta` — streaming reasoning summary.
   * Wire format: { method: "item/reasoning/summaryTextDelta", params: { threadId, turnId, itemId, delta, summaryIndex } }
   */
  private handleReasoningSummaryTextDelta(data: Record<string, unknown>, now: string): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    this.assistantText = ''
    this.thinkingText += delta
    return {
      entryType: 'thinking',
      content: this.thinkingText,
      timestamp: now,
      metadata: { streaming: true },
    }
  }

  /**
   * Handle `item/plan/delta` — streaming plan text.
   * Wire format: { method: "item/plan/delta", params: { threadId, turnId, itemId, delta } }
   */
  private handlePlanDelta(data: Record<string, unknown>, now: string): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    this.thinkingText = ''
    this.assistantText += delta
    return {
      entryType: 'assistant-message',
      content: this.assistantText,
      timestamp: now,
      metadata: { streaming: true, isPlan: true },
    }
  }

  // ---------- Response & legacy handlers ----------

  private handleResponse(data: Record<string, unknown>, now: string): NormalizedLogEntry | null {
    // Extract session ID from thread/start or thread/fork responses
    const result = data.result as Record<string, unknown> | undefined
    if (!result) return null
    const thread = result.thread as Record<string, unknown> | undefined
    if (thread?.id) {
      const model = (result.model as string) ?? ''
      const parts: string[] = []
      if (model) parts.push(`model: ${model}`)
      if (parts.length > 0) {
        return {
          entryType: 'system-message',
          content: parts.join('  '),
          timestamp: now,
          metadata: { subtype: 'session_configured', model },
        }
      }
    }
    return null
  }

  private handleItemStarted(data: Record<string, unknown>, now: string): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const item = (params.item ?? {}) as Record<string, unknown>
    const itemType = item.type as string | undefined

    if (itemType === 'commandExecution') {
      this.resetStreamingState()
      const commandStr = extractCommandString(item)
      const toolAction: ToolAction = {
        kind: 'command-run',
        command: commandStr,
        category: commandStr ? classifyCommand(commandStr) : 'other',
      }
      return {
        entryType: 'tool-use',
        content: 'Tool: Bash',
        timestamp: now,
        metadata: {
          streaming: true,
          toolName: 'Bash',
          toolCallId: item.id as string | undefined,
          input: commandStr ? { command: commandStr } : undefined,
        },
        toolAction,
      }
    }

    if (itemType === 'fileChange') {
      this.resetStreamingState()
      const path = item.path as string | undefined
      return {
        entryType: 'tool-use',
        content: 'Tool: Edit',
        timestamp: now,
        metadata: {
          streaming: true,
          toolName: 'Edit',
          toolCallId: item.id as string | undefined,
          path,
          input: path ? { file_path: path } : undefined,
        },
        toolAction: { kind: 'file-edit', path: path ?? '' },
      }
    }

    // McpToolCall: { type: "mcpToolCall", id, server, tool, arguments, status }
    if (itemType === 'mcpToolCall') {
      this.resetStreamingState()
      const server = (item.server as string) ?? 'unknown'
      const tool = (item.tool as string) ?? 'unknown'
      const toolName = `mcp:${server}:${tool}`
      return {
        entryType: 'tool-use',
        content: `Tool: ${toolName}`,
        timestamp: now,
        metadata: {
          streaming: true,
          toolName,
          toolCallId: item.id as string | undefined,
          input: item.arguments,
        },
        toolAction: { kind: 'tool', toolName, arguments: item.arguments },
      }
    }

    // DynamicToolCall: { type: "dynamicToolCall", id, tool, arguments, status }
    if (itemType === 'dynamicToolCall') {
      this.resetStreamingState()
      const toolName = (item.tool as string) ?? 'unknown'
      return {
        entryType: 'tool-use',
        content: `Tool: ${toolName}`,
        timestamp: now,
        metadata: {
          streaming: true,
          toolName,
          toolCallId: item.id as string | undefined,
          input: item.arguments,
        },
        toolAction: { kind: 'tool', toolName, arguments: item.arguments },
      }
    }

    // WebSearch: { type: "webSearch", id, query, action? }
    if (itemType === 'webSearch') {
      this.resetStreamingState()
      const query = (item.query as string) ?? ''
      return {
        entryType: 'tool-use',
        content: 'Tool: WebSearch',
        timestamp: now,
        metadata: {
          streaming: true,
          toolName: 'WebSearch',
          toolCallId: item.id as string | undefined,
          input: query ? { query } : undefined,
        },
        toolAction: { kind: 'web-fetch', url: query },
      }
    }

    // CollabAgentToolCall: { type: "collabAgentToolCall", id, tool, status, prompt? }
    if (itemType === 'collabAgentToolCall') {
      this.resetStreamingState()
      const tool = (item.tool as string) ?? 'unknown'
      const prompt = (item.prompt as string) ?? ''
      return {
        entryType: 'system-message',
        content: prompt ? `Agent ${tool}: ${prompt.slice(0, 100)}` : `Agent ${tool}`,
        timestamp: now,
        metadata: {
          subtype: 'collab_tool_call',
          toolCallId: item.id as string | undefined,
          tool,
        },
      }
    }

    // ImageView: { type: "imageView", id, path }
    if (itemType === 'imageView') {
      this.resetStreamingState()
      const path = (item.path as string) ?? ''
      return {
        entryType: 'tool-use',
        content: `View image: ${path}`,
        timestamp: now,
        metadata: { toolName: 'ViewImage', toolCallId: item.id as string | undefined, path },
        toolAction: { kind: 'file-read', path },
      }
    }

    // AgentMessage / Reasoning / Plan — text arrives via streaming deltas + item/completed.
    // Reset streaming state so stale text from a previous item doesn't leak.
    if (itemType === 'agentMessage' || itemType === 'reasoning' || itemType === 'plan') {
      this.resetStreamingState()
      return null
    }

    // EnteredReviewMode / ExitedReviewMode / ContextCompaction / ImageGeneration
    // — no useful started state (handled on completed)
    if (itemType === 'enteredReviewMode' || itemType === 'exitedReviewMode'
      || itemType === 'contextCompaction' || itemType === 'imageGeneration') {
      return null
    }

    return null
  }

  private handleItemCompleted(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const item = (params.item ?? {}) as Record<string, unknown>
    const itemType = item.type as string | undefined

    if (itemType === 'commandExecution') {
      const stdout = (item.stdout as string) ?? ''
      const stderr = (item.stderr as string) ?? ''
      const aggregated = (item.aggregatedOutput as string) ?? ''
      const combined = aggregated || [stdout, stderr].filter(Boolean).join('\n')
      const exitCode = item.exitCode as number | undefined
      const duration = (item.durationMs ?? item.duration) as number | undefined
      const commandStr = extractCommandString(item)
      return {
        entryType: 'tool-use',
        content: combined,
        timestamp: now,
        metadata: {
          toolName: 'Bash',
          isResult: true,
          toolCallId: item.id as string | undefined,
          exitCode,
          duration,
        },
        toolAction: {
          kind: 'command-run',
          command: commandStr,
          result: combined || undefined,
          category: commandStr ? classifyCommand(commandStr) : 'other',
        },
      }
    }

    if (itemType === 'fileChange') {
      const patches = item.patches as unknown[] | undefined
      const path = item.path as string | undefined
      const patchCount = patches?.length ?? 0
      const summary = path
        ? `File changed: ${path} (${patchCount} patch${patchCount !== 1 ? 'es' : ''})`
        : `File changed (${patchCount} patch${patchCount !== 1 ? 'es' : ''})`
      return {
        entryType: 'tool-use',
        content: summary,
        timestamp: now,
        metadata: {
          toolName: 'Edit',
          isResult: true,
          toolCallId: item.id as string | undefined,
          path,
        },
        toolAction: { kind: 'file-edit', path: path ?? '' },
      }
    }

    // ThreadItem::AgentMessage: { type: "agentMessage", id, text, phase?, memoryCitation? }
    if (itemType === 'agentMessage') {
      const text = (item.text as string) ?? ''
      if (!text) return null
      this.assistantText = ''
      this.thinkingText = ''
      return {
        entryType: 'assistant-message',
        content: text,
        timestamp: now,
      }
    }

    // ThreadItem::Reasoning: { type: "reasoning", id, summary: string[], content: string[] }
    if (itemType === 'reasoning') {
      const summary = item.summary as string[] | undefined
      const content = item.content as string[] | undefined
      const text = summary?.join('\n') || content?.join('\n') || ''
      if (!text) return null
      this.assistantText = ''
      this.thinkingText = ''
      return {
        entryType: 'thinking',
        content: text,
        timestamp: now,
      }
    }

    // McpToolCall: { type: "mcpToolCall", id, server, tool, result?, error?, durationMs?, status }
    if (itemType === 'mcpToolCall') {
      const server = (item.server as string) ?? 'unknown'
      const tool = (item.tool as string) ?? 'unknown'
      const toolName = `mcp:${server}:${tool}`
      const error = item.error as { message?: string } | undefined
      const result = item.result as { content?: unknown[] } | undefined
      const durationMs = item.durationMs as number | undefined
      let resultText = ''
      if (result?.content && Array.isArray(result.content)) {
        resultText = result.content
          .filter((b: unknown) => (b as Record<string, unknown>)?.type === 'text')
          .map((b: unknown) => (b as Record<string, string>).text)
          .join('\n')
      }
      const isError = !!error || item.status === 'failed'
      return {
        entryType: 'tool-use',
        content: resultText || error?.message || (isError ? 'MCP tool call failed' : 'MCP tool call completed'),
        timestamp: now,
        metadata: {
          toolName,
          isResult: true,
          toolCallId: item.id as string | undefined,
          exitCode: isError ? 1 : 0,
          ...(durationMs != null && { duration: durationMs }),
        },
        toolAction: { kind: 'tool', toolName, result: resultText || undefined },
      }
    }

    // DynamicToolCall: { type: "dynamicToolCall", id, tool, contentItems?, success?, durationMs?, status }
    if (itemType === 'dynamicToolCall') {
      const toolName = (item.tool as string) ?? 'unknown'
      const contentItems = item.contentItems as Array<{ type?: string, text?: string }> | undefined
      const durationMs = item.durationMs as number | undefined
      const isError = item.success === false || item.status === 'failed'
      const resultText = contentItems
        ?.filter(c => c.type === 'text')
        .map(c => c.text ?? '')
        .join('\n') ?? ''
      return {
        entryType: 'tool-use',
        content: resultText || (isError ? 'Tool call failed' : 'Tool call completed'),
        timestamp: now,
        metadata: {
          toolName,
          isResult: true,
          toolCallId: item.id as string | undefined,
          exitCode: isError ? 1 : 0,
          ...(durationMs != null && { duration: durationMs }),
        },
        toolAction: { kind: 'tool', toolName, result: resultText || undefined },
      }
    }

    // WebSearch: { type: "webSearch", id, query, action? }
    if (itemType === 'webSearch') {
      const query = (item.query as string) ?? ''
      const action = item.action as { type?: string } | undefined
      return {
        entryType: 'tool-use',
        content: query || 'Web search completed',
        timestamp: now,
        metadata: {
          toolName: 'WebSearch',
          isResult: true,
          toolCallId: item.id as string | undefined,
          ...(action?.type && { actionType: action.type }),
        },
        toolAction: { kind: 'web-fetch', url: query },
      }
    }

    // CollabAgentToolCall: { type: "collabAgentToolCall", id, tool, status, agentsStates? }
    if (itemType === 'collabAgentToolCall') {
      const tool = (item.tool as string) ?? 'unknown'
      const status = (item.status as string) ?? 'completed'
      return {
        entryType: 'system-message',
        content: `Agent ${tool}: ${status}`,
        timestamp: now,
        metadata: { subtype: 'collab_tool_call', toolCallId: item.id as string | undefined, tool },
      }
    }

    // Plan: { type: "plan", id, text }
    if (itemType === 'plan') {
      const text = (item.text as string) ?? ''
      if (!text) return null
      return {
        entryType: 'assistant-message',
        content: text,
        timestamp: now,
        metadata: { isPlan: true },
      }
    }

    // ImageView: { type: "imageView", id, path }
    if (itemType === 'imageView') {
      const path = (item.path as string) ?? ''
      return {
        entryType: 'tool-use',
        content: `View image: ${path}`,
        timestamp: now,
        metadata: { toolName: 'ViewImage', isResult: true, toolCallId: item.id as string | undefined, path },
        toolAction: { kind: 'file-read', path },
      }
    }

    // ImageGeneration: { type: "imageGeneration", id, status, result, revisedPrompt?, savedPath? }
    if (itemType === 'imageGeneration') {
      const result = (item.result as string) ?? ''
      const savedPath = item.savedPath as string | undefined
      return {
        entryType: 'tool-use',
        content: savedPath ? `Image saved: ${savedPath}` : 'Image generated',
        timestamp: now,
        metadata: {
          toolName: 'ImageGeneration',
          isResult: true,
          toolCallId: item.id as string | undefined,
          ...(savedPath && { path: savedPath }),
          ...(result && { result }),
        },
      }
    }

    // EnteredReviewMode: { type: "enteredReviewMode", id, review }
    if (itemType === 'enteredReviewMode') {
      return {
        entryType: 'system-message',
        content: (item.review as string) || 'Entered review mode',
        timestamp: now,
        metadata: { subtype: 'entered_review_mode' },
      }
    }

    // ExitedReviewMode: { type: "exitedReviewMode", id, review }
    if (itemType === 'exitedReviewMode') {
      return {
        entryType: 'system-message',
        content: 'Exited review mode',
        timestamp: now,
        metadata: { subtype: 'exited_review_mode' },
      }
    }

    // ContextCompaction: { type: "contextCompaction", id }
    if (itemType === 'contextCompaction') {
      return {
        entryType: 'system-message',
        content: 'Context compacted',
        timestamp: now,
      }
    }

    return null
  }

  private handleCommandOutputDelta(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    return {
      entryType: 'tool-use',
      content: delta,
      timestamp: now,
      metadata: { isResult: true, streaming: true },
    }
  }

  private handleFileChangeOutputDelta(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    return {
      entryType: 'tool-use',
      content: delta,
      timestamp: now,
      metadata: { isResult: true, streaming: true },
    }
  }

  private handleTurnStarted(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
    const turn = (params.turn ?? {}) as Record<string, unknown>
    return {
      entryType: 'system-message',
      content: 'Turn started',
      timestamp: now,
      metadata: {
        subtype: 'turn_started',
        turnId: turn.id as string | undefined,
      },
    }
  }

  private handleTurnCompleted(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
    const turn = (params.turn ?? {}) as Record<string, unknown>
    const usage = (turn.usage ?? {}) as Record<string, unknown>
    const inputTokens = usage.inputTokens as number | undefined
    const outputTokens = usage.outputTokens as number | undefined

    const parts: string[] = []
    if (inputTokens != null) {
      parts.push(
        inputTokens >= 1000 ? `${(inputTokens / 1000).toFixed(1)}k input` : `${inputTokens} input`,
      )
    }
    if (outputTokens != null) {
      parts.push(
        outputTokens >= 1000
          ? `${(outputTokens / 1000).toFixed(1)}k output`
          : `${outputTokens} output`,
      )
    }

    return {
      entryType: 'system-message',
      content: parts.length ? parts.join(' \u00B7 ') : 'Turn completed',
      timestamp: now,
      metadata: {
        source: 'result',
        turnCompleted: true,
        turnId: turn.id as string | undefined,
        inputTokens,
        outputTokens,
      },
    }
  }

  private handleThreadStarted(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
    const threadId = params.threadId as string | undefined
    return {
      entryType: 'system-message',
      content: 'Thread started',
      timestamp: now,
      metadata: { subtype: 'thread_started', threadId },
    }
  }

  private handleThreadStatusChanged(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const status = params.status as string | undefined
    if (status === 'systemError') {
      return {
        entryType: 'error-message',
        content: `Thread error: ${(params.message as string) ?? 'system error'}`,
        timestamp: now,
        metadata: { status },
      }
    }
    return null
  }

  private handleError(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
    const error = (params.error ?? {}) as Record<string, unknown>
    const willRetry = params.willRetry as boolean | undefined
    return {
      entryType: 'error-message',
      content: (error.message as string) ?? 'Unknown error',
      timestamp: now,
      metadata: {
        code: error.code as number | undefined,
        willRetry,
      },
    }
  }

  // ---------- Helpers ----------

  private resetStreamingState(): void {
    this.assistantText = ''
    this.thinkingText = ''
  }
}

/**
 * Extract the command string from a Codex item.
 * Codex sends `item.command` as either a string or string[] depending on version.
 */
function extractCommandString(item: Record<string, unknown>): string {
  const cmd = item.command
  if (typeof cmd === 'string') return cmd
  if (Array.isArray(cmd)) {
    return cmd
      .map((a: unknown) => {
        const s = String(a)
        return /\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
      })
      .join(' ')
  }
  const actions = item.commandActions as Array<{ command?: unknown }> | undefined
  const rawCmd = actions?.[0]?.command
  if (typeof rawCmd === 'string' && rawCmd) return rawCmd
  return ''
}
