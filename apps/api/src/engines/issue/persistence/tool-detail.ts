import { ulid } from 'ulid'
import { db } from '@/db'
import { issuesLogsToolsCall as toolsTable } from '@/db/schema'
import type {
  NormalizedLogEntry,
  TaskPlanItem,
  ToolAction,
  ToolDetail,
  UserQuestionItem,
} from '@/engines/types'
import { logger } from '@/logger'

/** Persist tool detail row linked to a log entry. */
export function persistToolDetail(
  logId: string,
  issueId: string,
  entry: NormalizedLogEntry,
): string | null {
  try {
    const toolName =
      typeof entry.metadata?.toolName === 'string' ?
        entry.metadata.toolName :
          (entry.toolAction?.kind ?? 'unknown')
    const toolCallId =
      typeof entry.metadata?.toolCallId === 'string' ? entry.metadata.toolCallId : null
    const isResult = entry.metadata?.isResult === true
    const action = entry.toolAction
    const kind = action?.kind ?? 'other'

    // Build raw JSON from all available data
    const rawData: Record<string, unknown> = {
      toolName,
      toolCallId,
      kind,
      isResult,
    }
    if (action) rawData.toolAction = action
    if (entry.metadata) rawData.metadata = entry.metadata
    if (entry.content) {
      const content = entry.content
      rawData.content = content.length > 5000 ? `${content.slice(0, 5000)}...[truncated]` : content
    }

    const toolRecordId = ulid()

    db.insert(toolsTable)
      .values({
        id: toolRecordId,
        logId,
        issueId,
        toolName,
        toolCallId,
        kind,
        isResult,
        raw: JSON.stringify(rawData),
      })
      .run()

    return toolRecordId
  } catch (error) {
    logger.warn({ err: error, logId, issueId }, 'persistToolDetail failed')
    return null
  }
}

/** Build a ToolDetail from an entry (pure function, no DB). */
export function buildToolDetail(entry: NormalizedLogEntry): ToolDetail | null {
  if (entry.entryType !== 'tool-use') return null
  const toolName =
    typeof entry.metadata?.toolName === 'string' ?
      entry.metadata.toolName :
        (entry.toolAction?.kind ?? 'unknown')
  const action = entry.toolAction
  const kind = action?.kind ?? 'other'
  const isResult = entry.metadata?.isResult === true

  return {
    kind,
    toolName,
    toolCallId:
      typeof entry.metadata?.toolCallId === 'string' ? entry.metadata.toolCallId : undefined,
    isResult,
  }
}

/** Reconstruct ToolAction from stored raw JSON. */
export function rawToToolAction(kind: string, rawData: Record<string, unknown>): ToolAction {
  const action = rawData.toolAction as Record<string, unknown> | undefined
  switch (kind) {
    case 'file-read':
      return { kind: 'file-read', path: (action?.path as string) ?? '' }
    case 'file-edit':
      return { kind: 'file-edit', path: (action?.path as string) ?? '' }
    case 'command-run':
      return { kind: 'command-run', command: (action?.command as string) ?? '' }
    case 'search':
      return { kind: 'search', query: (action?.query as string) ?? '' }
    case 'web-fetch':
      return { kind: 'web-fetch', url: (action?.url as string) ?? '' }
    case 'agent': {
      const pickString = (key: string): string | undefined => {
        const value = action?.[key]
        return typeof value === 'string' ? value : undefined
      }
      const subagentType = pickString('subagentType')
      const description = pickString('description')
      const prompt = pickString('prompt')
      const model = pickString('model')
      const runInBackground = action?.runInBackground === true ? true : undefined
      const isolation = pickString('isolation')
      const name = pickString('name')
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
    case 'task-plan': {
      const rawItems = Array.isArray(action?.items) ? (action.items as unknown[]) : []
      const items: TaskPlanItem[] = rawItems
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
        .filter((i): i is TaskPlanItem => i !== null)
      return { kind: 'task-plan', items }
    }
    case 'user-question': {
      const rawQuestions = Array.isArray(action?.questions) ? (action.questions as unknown[]) : []
      const questions: UserQuestionItem[] = rawQuestions
        .map((raw) => {
          if (typeof raw !== 'object' || raw === null) return null
          const obj = raw as Record<string, unknown>
          const question = typeof obj.question === 'string' ? obj.question : null
          if (!question) return null
          const rawOptions = Array.isArray(obj.options) ? obj.options : null
          const options = rawOptions
            ?.map((opt) => {
              if (typeof opt !== 'object' || opt === null) return null
              const o = opt as Record<string, unknown>
              const label = typeof o.label === 'string' ? o.label : null
              if (!label) return null
              const description = typeof o.description === 'string' ? o.description : undefined
              const recommended = o.recommended === true ? true : undefined
              return {
                label,
                ...(description !== undefined ? { description } : {}),
                ...(recommended !== undefined ? { recommended } : {}),
              }
            })
            .filter(
              (o): o is { label: string, description?: string, recommended?: boolean } => o !== null,
            )
          const multiSelect = obj.multiSelect === true ? true : undefined
          return {
            question,
            ...(options && options.length > 0 ? { options } : {}),
            ...(multiSelect !== undefined ? { multiSelect } : {}),
          }
        })
        .filter((q): q is UserQuestionItem => q !== null)
      const recommendedIndex =
        typeof action?.recommendedIndex === 'number' ? action.recommendedIndex : undefined
      return {
        kind: 'user-question',
        questions,
        ...(recommendedIndex !== undefined ? { recommendedIndex } : {}),
      }
    }
    case 'tool': {
      const toolName = (action?.toolName as string) ?? (rawData.toolName as string) ?? ''
      const args = action?.arguments
      const result = action?.result
      return {
        kind: 'tool',
        toolName,
        ...(args !== undefined ? { arguments: args } : {}),
        ...(result !== undefined ? { result } : {}),
      }
    }
    default:
      return {
        kind: 'other',
        description: (rawData.toolName as string) ?? kind,
      }
  }
}
