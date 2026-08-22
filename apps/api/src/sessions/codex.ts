import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { classifyToolAction, classifyToolKind } from '@/engines/executors/claude/normalizer-tool'
import type { NormalizedLogEntry } from '@/engines/types'
import { fileStats, readAllLines, readHeadLines, str, toTitle } from './parse'
import type { LocalSessionRecord } from './types'

/**
 * Codex stores one rollout per thread at
 * `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl`.
 */
export function codexSessionsRoot(): string {
  const home = str(process.env.CODEX_HOME) ?? join(homedir(), '.codex')
  return join(home, 'sessions')
}

export async function listCodexSessions(
  root: string = codexSessionsRoot(),
): Promise<LocalSessionRecord[]> {
  const files = await readdir(root, { recursive: true }).catch(() => [] as string[])
  const sessions: LocalSessionRecord[] = []

  for (const file of files) {
    const name = file.split('/').at(-1) ?? ''
    if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
    const record = await describeSession(join(root, file))
    if (record) sessions.push(record)
  }

  return sessions
}

async function describeSession(path: string): Promise<LocalSessionRecord | null> {
  const stats = await fileStats(path)
  if (!stats) return null

  const lines = await readHeadLines(path).catch(() => [])
  const meta = lines.find(line => line.type === 'session_meta')?.payload as
    | Record<string, unknown>
    | undefined
  if (!meta) return null

  // Subagent threads are spawned by another rollout — they belong to that
  // thread, not to the top-level session list.
  const source = meta.source as { subagent?: unknown } | undefined
  if (source?.subagent) return null

  const sessionId = str(meta.id) ?? str(meta.session_id)
  if (!sessionId) return null

  const turnContext = lines.find(line => line.type === 'turn_context')?.payload as
    | Record<string, unknown>
    | undefined

  return {
    engine: 'codex',
    sessionId,
    cwd: str(meta.cwd) ?? '',
    title: toTitle(firstPrompt(lines)),
    startedAt: str(meta.timestamp) ?? str(lines[0]?.timestamp),
    cliVersion: str(meta.cli_version),
    model: str(turnContext?.model),
    ...stats,
    path,
  }
}

function firstPrompt(lines: Record<string, unknown>[]): string | undefined {
  for (const line of lines) {
    const payload = line.payload as Record<string, unknown> | undefined
    if (line.type === 'event_msg' && payload?.type === 'user_message') {
      const text = str(payload.message)
      if (text) return text
    }
  }
  return undefined
}

/**
 * Map rollout payloads to normalized entries.
 *
 * Rollout files use a different wire format from the app-server JSON-RPC
 * stream `CodexLogNormalizer` consumes, so the handful of payload types that
 * carry user-visible content are mapped directly. Everything else (token
 * counts, world state, turn bookkeeping) is dropped.
 */
export async function readCodexSession(
  record: LocalSessionRecord,
): Promise<NormalizedLogEntry[]> {
  const entries: NormalizedLogEntry[] = []

  for (const line of await readAllLines(record.path)) {
    const payload = line.payload as Record<string, unknown> | undefined
    if (!payload) continue
    const timestamp = str(line.timestamp)
    const type = str(payload.type)

    if (line.type === 'event_msg') {
      if (type === 'user_message' && str(payload.message)) {
        entries.push({ entryType: 'user-message', content: String(payload.message), timestamp })
      } else if (type === 'agent_message' && str(payload.message)) {
        entries.push({ entryType: 'assistant-message', content: String(payload.message), timestamp })
      } else if (type === 'agent_reasoning' && str(payload.text)) {
        entries.push({ entryType: 'thinking', content: String(payload.text), timestamp })
      }
      continue
    }

    if (line.type !== 'response_item') continue

    if (type === 'function_call' || type === 'custom_tool_call') {
      const toolName = str(payload.name) ?? 'tool'
      const input = parseToolInput(payload.arguments ?? payload.input)
      entries.push({
        entryType: 'tool-use',
        content: toolContent(input) ?? toolName,
        timestamp,
        metadata: { toolName, input, toolCallId: str(payload.call_id) ?? '' },
        toolAction: classifyToolAction(toolName, input),
        toolDetail: {
          kind: classifyToolKind(toolName),
          toolName,
          toolCallId: str(payload.call_id),
          isResult: false,
          raw: input,
        },
      })
      continue
    }

    if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      entries.push({
        entryType: 'tool-use',
        content: str(payload.output) ?? '',
        timestamp,
        metadata: { toolCallId: str(payload.call_id) ?? '', isResult: true },
      })
    }
  }

  return entries
}

function parseToolInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : { input: raw }
  } catch {
    return { input: raw }
  }
}

function toolContent(input: Record<string, unknown>): string | undefined {
  return str(input.cmd) ?? str(input.command) ?? str(input.path) ?? str(input.file_path) ?? str(input.input)
}
