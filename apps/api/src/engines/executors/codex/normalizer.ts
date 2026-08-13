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
   * Last seen cumulative thread token totals (from thread/tokenUsage/updated).
   * Initialized to `total - last` on first sight so a resumed thread's
   * history is excluded from the first delta.
   */
  private prevTokenTotal: TokenBreakdown | null = null
  /** Per-turn token deltas accumulated since the last turn/completed. */
  private turnTokens: TokenBreakdown = zeroBreakdown()

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
        // New summary segment — reset so next summaryTextDelta starts fresh
        this.thinkingText = ''
        return null

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

      case 'thread/tokenUsage/updated':
        return this.handleTokenUsageUpdated(data, now)

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

    // CommandExecution: { type: "commandExecution", id, command (string), cwd, commandActions, status, ... }
    if (itemType === 'commandExecution') {
      this.resetStreamingState()
      const commandStr = extractCommandString(item)
      const cwd = item.cwd as string | undefined
      const description = extractCommandDescription(item)
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
          toolName: 'Bash',
          toolCallId: item.id as string | undefined,
          input: {
            ...(commandStr && { command: commandStr }),
            ...(description && { description }),
          },
          ...(cwd && { cwd }),
        },
        toolAction,
      }
    }

    // FileChange: { type: "fileChange", id, changes: [{path, kind, diff}], status }
    if (itemType === 'fileChange') {
      this.resetStreamingState()
      const changes = item.changes as Array<{ path?: string, kind?: unknown, diff?: string }> | undefined
      const paths = changes?.map(c => c.path).filter(Boolean) as string[] ?? []
      const firstPath = paths[0] ?? ''
      const input = fileChangesToInput(changes)
      return {
        entryType: 'tool-use',
        content: 'Tool: Edit',
        timestamp: now,
        metadata: {
          toolName: 'Edit',
          toolCallId: item.id as string | undefined,
          path: firstPath || undefined,
          input,
        },
        toolAction: { kind: 'file-edit', path: firstPath },
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

    // CommandExecution completed: { type: "commandExecution", id, command, cwd, aggregatedOutput?, exitCode?, durationMs?, status }
    if (itemType === 'commandExecution') {
      const output = (item.aggregatedOutput as string) ?? ''
      const exitCode = item.exitCode as number | undefined
      const durationMs = item.durationMs as number | undefined
      const commandStr = extractCommandString(item)
      return {
        entryType: 'tool-use',
        content: output,
        timestamp: now,
        metadata: {
          toolName: 'Bash',
          isResult: true,
          toolCallId: item.id as string | undefined,
          exitCode,
          ...(durationMs != null && { duration: durationMs }),
        },
        toolAction: {
          kind: 'command-run',
          command: commandStr,
          result: output || undefined,
          category: commandStr ? classifyCommand(commandStr) : 'other',
        },
      }
    }

    // FileChange completed: { type: "fileChange", id, changes: [{path, kind, diff}], status }
    if (itemType === 'fileChange') {
      const changes = item.changes as Array<{ path?: string, kind?: unknown, diff?: string }> | undefined
      const paths = changes?.map(c => c.path).filter(Boolean) as string[] ?? []
      const firstPath = paths[0] ?? ''
      const changeCount = changes?.length ?? 0
      const status = item.status as string | undefined
      const isError = status === 'failed' || status === 'declined'

      // Build a content summary from changes
      const summary = paths.length > 0
        ? paths.length === 1
          ? `File changed: ${firstPath}`
          : `${changeCount} files changed: ${paths.join(', ')}`
        : `File changed (${changeCount} change${changeCount !== 1 ? 's' : ''})`

      return {
        entryType: 'tool-use',
        content: summary,
        timestamp: now,
        metadata: {
          toolName: 'Edit',
          isResult: true,
          toolCallId: item.id as string | undefined,
          path: firstPath || undefined,
          exitCode: isError ? 1 : 0,
          ...(paths.length > 1 && { changedPaths: paths }),
        },
        toolAction: { kind: 'file-edit', path: firstPath },
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

    // SubAgentActivity: { type: "subAgentActivity", id, agentPath,
    //   agentThreadId, kind: "started"|"interacted"|"interrupted" }
    if (itemType === 'subAgentActivity') {
      const agentPath = (item.agentPath as string) ?? 'agent'
      const kind = (item.kind as string) ?? 'started'
      return {
        entryType: 'system-message',
        content: `Sub-agent ${agentPath}: ${kind}`,
        timestamp: now,
        metadata: {
          subtype: 'sub_agent_activity',
          toolCallId: item.id as string | undefined,
          agentThreadId: item.agentThreadId as string | undefined,
          kind,
        },
      }
    }

    // HookPrompt: { type: "hookPrompt", id, fragments: [{hookRunId, text}] }
    if (itemType === 'hookPrompt') {
      const fragments = item.fragments as Array<{ text?: string }> | undefined
      const text = fragments?.map(f => f.text ?? '').filter(Boolean).join('\n') ?? ''
      if (!text) return null
      return {
        entryType: 'system-message',
        content: text,
        timestamp: now,
        metadata: { subtype: 'hook_prompt', toolCallId: item.id as string | undefined },
      }
    }

    // Sleep: { type: "sleep", id, durationMs }
    if (itemType === 'sleep') {
      const durationMs = item.durationMs as number | undefined
      return {
        entryType: 'system-message',
        content: `Slept ${durationMs ?? 0}ms`,
        timestamp: now,
        metadata: {
          subtype: 'sleep',
          toolCallId: item.id as string | undefined,
          ...(durationMs != null && { duration: durationMs }),
        },
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
    const itemId = params.itemId as string | undefined
    return {
      entryType: 'tool-use',
      content: delta,
      timestamp: now,
      metadata: {
        toolName: 'Bash',
        isResult: true,
        streaming: true,
        ...(itemId && { toolCallId: itemId }),
      },
    }
  }

  private handleFileChangeOutputDelta(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const params = (data.params ?? {}) as Record<string, unknown>
    const delta = params.delta as string | undefined
    if (!delta) return null
    const itemId = params.itemId as string | undefined
    return {
      entryType: 'tool-use',
      content: delta,
      timestamp: now,
      metadata: {
        toolName: 'Edit',
        isResult: true,
        streaming: true,
        ...(itemId && { toolCallId: itemId }),
      },
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

  /**
   * Handle `thread/tokenUsage/updated`.
   * Wire format (0.144.x schema): { params: { threadId, turnId,
   *   tokenUsage: { last: TokenUsageBreakdown, total: TokenUsageBreakdown,
   *   modelContextWindow? } } }
   * Tracks per-turn deltas of the cumulative `total` breakdown so
   * turn/completed can report the turn's own token consumption.
   */
  private handleTokenUsageUpdated(
    data: Record<string, unknown>,
    now: string,
  ): NormalizedLogEntry | null {
    const p = (data.params ?? {}) as Record<string, unknown>
    const tokenUsage = (p.tokenUsage ?? {}) as Record<string, unknown>
    const total = parseBreakdown(tokenUsage.total)
    const last = parseBreakdown(tokenUsage.last)
    if (!total) return null

    // Baseline excludes thread history on first sight (resumed threads).
    const baseline =
      this.prevTokenTotal ?? (last ? subtractBreakdown(total, last) : zeroBreakdown())
    this.turnTokens = addBreakdown(this.turnTokens, subtractBreakdown(total, baseline))
    this.prevTokenTotal = total

    const contextWindow = tokenUsage.modelContextWindow as number | undefined
    if (!total.totalTokens) return null
    return {
      entryType: 'token-usage',
      content: `Tokens: ${total.totalTokens}${contextWindow ? ` / Context: ${contextWindow}` : ''}`,
      timestamp: now,
      metadata: {
        totalTokens: total.totalTokens,
        ...(contextWindow != null && { contextWindow }),
        inputTokens: total.inputTokens,
        outputTokens: total.outputTokens,
        cachedInputTokens: total.cachedInputTokens,
        reasoningOutputTokens: total.reasoningOutputTokens,
      },
    }
  }

  private handleTurnCompleted(data: Record<string, unknown>, now: string): NormalizedLogEntry {
    const params = (data.params ?? {}) as Record<string, unknown>
    const turn = (params.turn ?? {}) as Record<string, unknown>
    const status = turn.status as string | undefined

    // Legacy servers put usage directly on the turn; current schema has no
    // turn.usage \u2014 fall back to the deltas tracked from tokenUsage/updated.
    const usage = (turn.usage ?? {}) as Record<string, unknown>
    const tracked = this.turnTokens
    this.turnTokens = zeroBreakdown()
    const inputTokens =
      (usage.inputTokens as number | undefined) ?? (tracked.inputTokens || undefined)
    const outputTokens =
      (usage.outputTokens as number | undefined) ?? (tracked.outputTokens || undefined)
    const cachedInputTokens = tracked.cachedInputTokens || undefined
    const reasoningOutputTokens = tracked.reasoningOutputTokens || undefined

    const tokenMetadata = {
      inputTokens,
      outputTokens,
      ...(cachedInputTokens != null && { cachedInputTokens }),
      ...(reasoningOutputTokens != null && { reasoningOutputTokens }),
    }

    if (status === 'failed') {
      const error = (turn.error ?? {}) as Record<string, unknown>
      const message = (error.message as string) ?? 'Turn failed'
      return {
        entryType: 'error-message',
        content: `Turn failed \u00B7 ${message}`,
        timestamp: now,
        metadata: {
          source: 'result',
          turnCompleted: true,
          resultSubtype: 'failed',
          isError: true,
          error: message,
          errorKind: codexErrorKind(error.codexErrorInfo),
          turnId: turn.id as string | undefined,
          ...tokenMetadata,
        },
      }
    }

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
    if (status === 'interrupted') {
      parts.unshift('Turn interrupted')
    }

    return {
      entryType: 'system-message',
      content: parts.length ? parts.join(' \u00B7 ') : 'Turn completed',
      timestamp: now,
      metadata: {
        source: 'result',
        turnCompleted: true,
        ...(status === 'interrupted' && { resultSubtype: 'interrupted' }),
        turnId: turn.id as string | undefined,
        ...tokenMetadata,
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
    const status = threadStatusType(params.status)
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
        errorKind: codexErrorKind(error.codexErrorInfo),
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

// ---------- Token usage helpers ----------

/** Mirror of the schema's TokenUsageBreakdown (all fields required on the wire). */
interface TokenBreakdown {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

function zeroBreakdown(): TokenBreakdown {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  }
}

function parseBreakdown(raw: unknown): TokenBreakdown | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  return {
    inputTokens: num(r.inputTokens),
    cachedInputTokens: num(r.cachedInputTokens),
    outputTokens: num(r.outputTokens),
    reasoningOutputTokens: num(r.reasoningOutputTokens),
    totalTokens: num(r.totalTokens),
  }
}

function addBreakdown(a: TokenBreakdown, b: TokenBreakdown): TokenBreakdown {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

/** Clamped a - b (never negative — totals are monotonic, guard against resets). */
function subtractBreakdown(a: TokenBreakdown, b: TokenBreakdown): TokenBreakdown {
  return {
    inputTokens: Math.max(0, a.inputTokens - b.inputTokens),
    cachedInputTokens: Math.max(0, a.cachedInputTokens - b.cachedInputTokens),
    outputTokens: Math.max(0, a.outputTokens - b.outputTokens),
    reasoningOutputTokens: Math.max(0, a.reasoningOutputTokens - b.reasoningOutputTokens),
    totalTokens: Math.max(0, a.totalTokens - b.totalTokens),
  }
}

/**
 * Read the discriminant of a `ThreadStatus`. The wire format is an object
 * (`{"type":"idle"}`, `{"type":"active","activeFlags":[...]}`); older servers
 * sent a bare string.
 */
function threadStatusType(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const type = (raw as Record<string, unknown>).type
    return typeof type === 'string' ? type : undefined
  }
  return undefined
}

/**
 * Normalize `codexErrorInfo` to a string kind. The schema encodes it either
 * as a plain enum string (e.g. "usageLimitExceeded") or as a single-key
 * object variant (e.g. {"httpConnectionFailed": {"httpStatusCode": 502}}).
 */
function codexErrorKind(info: unknown): string | undefined {
  if (typeof info === 'string') return info
  if (info && typeof info === 'object') return Object.keys(info)[0]
  return undefined
}

/**
 * Build input metadata from v2 FileChange changes array.
 * FileUpdateChange: { path, kind: { type: "add"|"delete"|"update" }, diff }
 */
function fileChangesToInput(
  changes: Array<{ path?: string, kind?: unknown, diff?: string }> | undefined,
): Record<string, unknown> | undefined {
  if (!changes || changes.length === 0) return undefined
  if (changes.length === 1) {
    const c = changes[0]
    const kind = c.kind as { type?: string } | undefined
    return {
      file_path: c.path ?? '',
      ...(kind?.type && { changeType: kind.type }),
      ...(c.diff && { unified_diff: c.diff }),
    }
  }
  // Multiple files — summarize
  return {
    files: changes.map(c => ({
      file_path: c.path ?? '',
      changeType: (c.kind as { type?: string } | undefined)?.type,
    })),
  }
}

/**
 * Extract the command string from a v2 CommandExecution item.
 * v2 sends `command` as a string; also check `commandActions[0].command` as fallback.
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

/**
 * Extract a description from v2 CommandExecution commandActions.
 * CommandAction: { type: "read"|"listFiles"|"search"|... } with action-specific fields.
 */
function extractCommandDescription(item: Record<string, unknown>): string | undefined {
  const actions = item.commandActions as Array<Record<string, unknown>> | undefined
  if (!actions || actions.length === 0) return undefined
  const first = actions[0]
  if (!first) return undefined
  switch (first.type) {
    case 'read':
      return `Read ${first.path ?? ''}`
    case 'listFiles':
      return `List files${first.path ? ` in ${first.path}` : ''}`
    case 'search':
      return `Search${first.query ? ` "${first.query}"` : ''}${first.path ? ` in ${first.path}` : ''}`
    default:
      return undefined
  }
}
