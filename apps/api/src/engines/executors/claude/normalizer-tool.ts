import { classifyCommand } from '@/engines/logs'
import type { CommandCategory, ToolAction } from '@/engines/types'
import type { ToolCallInfo } from './normalizer-types'

/** Extract concatenated text from content blocks. */
export function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts = content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
    return texts.length > 0 ? texts.join('') : null
  }
  return null
}

/** Generate concise, human-readable content for a tool invocation. */
export function generateToolContent(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return String(input.file_path ?? input.path ?? toolName)
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return String(input.file_path ?? input.path ?? toolName)
    case 'Bash':
      return String(input.command ?? input.cmd ?? toolName)
    case 'Grep':
      return input.path ? `${input.pattern} in ${input.path}` : String(input.pattern ?? toolName)
    case 'Glob':
      return input.path
        ? `${input.pattern ?? input.filePattern} in ${input.path}`
        : String(input.pattern ?? input.filePattern ?? toolName)
    case 'LS':
      return String(input.path ?? toolName)
    case 'WebFetch':
    case 'web_fetch':
      return String(input.url ?? toolName)
    case 'WebSearch':
    case 'web_search':
      return String(input.query ?? toolName)
    case 'Task':
      return input.description ? `Task: ${input.description}` : 'Task'
    case 'Agent': {
      // SDK AgentInput (0.2.113) carries identity + lifecycle hints we should
      // surface: subagent_type, model, run_in_background, isolation, name.
      const subtype = typeof input.subagent_type === 'string' ? input.subagent_type : undefined
      const description = typeof input.description === 'string' ? input.description : undefined
      const prompt = typeof input.prompt === 'string' ? input.prompt : undefined
      const body = description ?? prompt ?? 'Agent'
      const prefix = subtype ? `[${subtype}] ` : ''

      const flags: string[] = []
      if (typeof input.model === 'string') flags.push(input.model)
      if (input.run_in_background === true) flags.push('bg')
      if (input.isolation === 'worktree') flags.push('worktree')
      if (typeof input.name === 'string' && input.name.length > 0) {
        flags.push(`as ${input.name}`)
      }
      const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : ''
      return `${prefix}${body}${suffix}`
    }
    case 'TodoWrite':
      return 'TODO list updated'
    case 'ExitPlanMode':
      return String(input.plan ?? 'Plan submitted')
    case 'NotebookEdit':
      return String(input.notebook_path ?? toolName)
    case 'ScheduleWakeup': {
      const delay = input.delaySeconds
      const reason = typeof input.reason === 'string' ? input.reason : undefined
      if (typeof delay === 'number') {
        return reason ? `wake in ${delay}s — ${reason}` : `wake in ${delay}s`
      }
      return reason ?? 'ScheduleWakeup'
    }
    case 'Monitor': {
      // Claude CLI runtime tool for streaming background task output.
      // No published schema — accept common shapes defensively.
      const taskId = input.task_id ?? input.taskId ?? input.shell_id
      const cmd = input.command ?? input.until
      if (taskId) return `monitor ${String(taskId)}`
      if (cmd) return `monitor ${String(cmd)}`
      return 'Monitor'
    }
    case 'TaskOutput':
      return input.task_id ? `output ${String(input.task_id)}` : 'TaskOutput'
    case 'TaskStop':
      return input.task_id || input.shell_id
        ? `stop ${String(input.task_id ?? input.shell_id)}`
        : 'TaskStop'
    case 'AskUserQuestion': {
      const qs = input.questions
      if (Array.isArray(qs) && qs.length > 0) {
        const first = qs[0] as { question?: unknown }
        const q = typeof first?.question === 'string' ? first.question : undefined
        if (q) return qs.length > 1 ? `${q} (+${qs.length - 1})` : q
      }
      return 'AskUserQuestion'
    }
    case 'EnterWorktree': {
      const target = input.path ?? input.name
      return target ? `worktree: ${String(target)}` : 'EnterWorktree (new)'
    }
    case 'ExitWorktree': {
      const action = typeof input.action === 'string' ? input.action : 'exit'
      return `worktree ${action}`
    }
    // Server-side tools
    case 'code_execution':
    case 'bash_code_execution':
      return String(input.code ?? input.command ?? `Server: ${toolName}`)
    case 'text_editor_code_execution':
      return String(input.command ?? `Server: ${toolName}`)
    case 'tool_search_tool_regex':
    case 'tool_search_tool_bm25':
      return String(input.query ?? `Server: ${toolName}`)
    default: {
      // MCP tools: mcp__server__tool → mcp:server:tool
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__')
        if (parts.length >= 3) {
          return `mcp:${parts[1]}:${parts[2]}`
        }
      }
      return `Tool: ${toolName}`
    }
  }
}

/** Classify tool kind for ToolDetail.kind field. */
export function classifyToolKind(toolName: string): string {
  switch (toolName) {
    case 'Read':
      return 'file-read'
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return 'file-edit'
    case 'Bash':
      return 'command-run'
    case 'Grep':
    case 'Glob':
      return 'search'
    case 'WebFetch':
    case 'web_fetch':
      return 'web-fetch'
    case 'WebSearch':
    case 'web_search':
      return 'search'
    case 'Task':
      return 'task'
    case 'Agent':
      return 'agent'
    case 'TodoWrite':
      return 'task-plan'
    case 'AskUserQuestion':
      return 'user-question'
    case 'code_execution':
    case 'bash_code_execution':
    case 'text_editor_code_execution':
      return 'command-run'
    case 'tool_search_tool_regex':
    case 'tool_search_tool_bm25':
      return 'search'
    default:
      return 'tool'
  }
}

/** Classify a tool action (for ToolAction discriminated union). */
export function classifyToolAction(toolName: string, input: Record<string, unknown>): ToolAction {
  switch (toolName) {
    case 'Read':
      return {
        kind: 'file-read',
        path: String(input.file_path ?? input.path ?? ''),
      }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return {
        kind: 'file-edit',
        path: String(input.file_path ?? input.path ?? ''),
      }
    case 'Bash':
    case 'code_execution':
    case 'bash_code_execution':
      return {
        kind: 'command-run',
        command: String(input.command ?? input.code ?? input.cmd ?? ''),
        category: classifyCommand(String(input.command ?? input.code ?? input.cmd ?? '')) as CommandCategory,
      }
    case 'text_editor_code_execution':
      return {
        kind: 'command-run',
        command: String(input.command ?? ''),
        category: 'edit' as CommandCategory,
      }
    case 'Grep':
    case 'Glob':
    case 'tool_search_tool_regex':
    case 'tool_search_tool_bm25':
      return {
        kind: 'search',
        query: String(input.pattern ?? input.query ?? input.filePattern ?? ''),
      }
    case 'WebFetch':
    case 'web_fetch':
      return { kind: 'web-fetch', url: String(input.url ?? '') }
    case 'WebSearch':
    case 'web_search':
      return { kind: 'search', query: String(input.query ?? '') }
    case 'Agent': {
      const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : undefined
      const description = typeof input.description === 'string' ? input.description : undefined
      const prompt = typeof input.prompt === 'string' ? input.prompt : undefined
      const model = typeof input.model === 'string' ? input.model : undefined
      const runInBackground = input.run_in_background === true ? true : undefined
      const isolation = typeof input.isolation === 'string' ? input.isolation : undefined
      const name = typeof input.name === 'string' ? input.name : undefined
      return {
        kind: 'agent',
        ...(subagentType !== undefined ? { subagentType } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(prompt !== undefined ? { prompt } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(runInBackground !== undefined ? { runInBackground } : {}),
        ...(isolation !== undefined ? { isolation } : {}),
        ...(name !== undefined ? { name } : {}),
      }
    }
    case 'TodoWrite': {
      const rawTodos = Array.isArray(input.todos) ? input.todos : []
      const items = rawTodos
        .map((raw) => {
          if (typeof raw !== 'object' || raw === null) return null
          const obj = raw as Record<string, unknown>
          const content = typeof obj.content === 'string' ? obj.content : null
          if (!content) return null
          const status = typeof obj.status === 'string' ? obj.status : 'pending'
          const activeForm = typeof obj.activeForm === 'string' ? obj.activeForm : undefined
          return activeForm !== undefined
            ? { content, status, activeForm }
            : { content, status }
        })
        .filter((item): item is { content: string, status: string, activeForm?: string } => item !== null)
      return { kind: 'task-plan', items }
    }
    case 'AskUserQuestion': {
      const rawQuestions = Array.isArray(input.questions) ? input.questions : []
      let recommendedIndex: number | undefined
      const questions = rawQuestions
        .map((raw, qIdx) => {
          if (typeof raw !== 'object' || raw === null) return null
          const obj = raw as Record<string, unknown>
          const question = typeof obj.question === 'string' ? obj.question : null
          if (!question) return null
          const multiSelect = obj.multiSelect === true || obj.multi_select === true ? true : undefined
          const rawOptions = Array.isArray(obj.options) ? obj.options : null
          const options = rawOptions
            ?.map((opt, oIdx) => {
              if (typeof opt !== 'object' || opt === null) return null
              const o = opt as Record<string, unknown>
              const label = typeof o.label === 'string' ? o.label : null
              if (!label) return null
              const description = typeof o.description === 'string' ? o.description : undefined
              const recommended = label.toLowerCase().includes('(recommended)') || o.recommended === true
              if (recommended && qIdx === 0 && recommendedIndex === undefined) {
                recommendedIndex = oIdx
              }
              return {
                label,
                ...(description !== undefined ? { description } : {}),
                ...(recommended ? { recommended: true } : {}),
              }
            })
            .filter((o): o is { label: string, description?: string, recommended?: boolean } => o !== null)
          return {
            question,
            ...(options && options.length > 0 ? { options } : {}),
            ...(multiSelect !== undefined ? { multiSelect } : {}),
          }
        })
        .filter((q): q is { question: string, options?: Array<{ label: string, description?: string, recommended?: boolean }>, multiSelect?: boolean } => q !== null)
      return {
        kind: 'user-question',
        questions,
        ...(recommendedIndex !== undefined ? { recommendedIndex } : {}),
      }
    }
    default:
      return { kind: 'tool', toolName, arguments: input }
  }
}

/** Normalize tool_result content to a plain string. */
export function normalizeToolResultContent(content: string | unknown[] | undefined): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'string') return part
        if (
          typeof part === 'object' &&
          part !== null &&
          'text' in part &&
          typeof (part as { text: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text
        }
        return JSON.stringify(part)
      })
      .join('\n')
  }
  return JSON.stringify(content ?? '')
}

/** Build raw object for tool result persistence. */
export function buildToolResultRaw(
  info: ToolCallInfo,
  resultContent: string,
  isError?: boolean,
): Record<string, unknown> {
  return {
    toolName: info.toolName,
    input: info.input,
    result: resultContent,
    isError: isError ?? false,
  }
}

export function normalizeExecutionError(raw: string): {
  kind?: string
  summary: string
} {
  const lower = raw.toLowerCase()
  if (lower.includes('lsp server plugin:rust-analyzer-lsp') && lower.includes('crashed')) {
    return {
      kind: 'rust_analyzer_crash',
      summary:
        'Rust analyzer LSP crashed during execution. Retry the task or disable Rust tooling.',
    }
  }
  const compact = raw.replace(/\s+/g, ' ').trim()
  return {
    summary: compact.length > 300 ? `${compact.slice(0, 300)}...` : compact,
  }
}
