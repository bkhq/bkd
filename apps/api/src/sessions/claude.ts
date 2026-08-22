import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { ClaudeLogNormalizer } from '@/engines/executors/claude'
import type { NormalizedLogEntry } from '@/engines/types'
import { fileStats, readAllLines, readHeadLines, str, toTitle } from './parse'
import type { LocalSessionRecord } from './types'

/**
 * Claude Code stores one transcript per session at
 * `<config>/projects/<cwd-with-slashes-replaced-by-dashes>/<sessionId>.jsonl`.
 * A sibling `<sessionId>/` directory holds subagent transcripts and spilled
 * tool results; it is not a session and must not be listed.
 */
export function claudeProjectsRoot(): string {
  const configDir = str(process.env.CLAUDE_CONFIG_DIR) ?? join(homedir(), '.claude')
  return join(configDir, 'projects')
}

/** Line types the transcript shares with the stdout stream-json envelopes. */
const NORMALIZABLE_TYPES = new Set(['user', 'assistant', 'system'])

export async function listClaudeSessions(
  root: string = claudeProjectsRoot(),
): Promise<LocalSessionRecord[]> {
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  const sessions: LocalSessionRecord[] = []

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const dirPath = join(root, dir.name)
    const files = await readdir(dirPath).catch(() => [])
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const record = await describeSession(join(dirPath, file))
      if (record) sessions.push(record)
    }
  }

  return sessions
}

async function describeSession(path: string): Promise<LocalSessionRecord | null> {
  const stats = await fileStats(path)
  if (!stats) return null

  const lines = await readHeadLines(path).catch(() => [])
  if (lines.length === 0) return null

  const withCwd = lines.find(line => str(line.cwd))
  const assistant = lines.find(line => line.type === 'assistant')

  return {
    engine: 'claude-code',
    // The filename is authoritative: `--resume` resolves sessions by it.
    sessionId: basename(path, '.jsonl'),
    cwd: str(withCwd?.cwd) ?? '',
    title: toTitle(firstPrompt(lines)),
    startedAt: str(lines[0]?.timestamp),
    gitBranch: str(lines.find(line => str(line.gitBranch))?.gitBranch),
    cliVersion: str(lines.find(line => str(line.version))?.version),
    model: str((assistant?.message as { model?: unknown } | undefined)?.model),
    ...stats,
    path,
  }
}

/** First real user prompt — CLI-injected wrappers and meta lines are skipped. */
function firstPrompt(lines: Record<string, unknown>[]): string | undefined {
  for (const line of lines) {
    if (line.type !== 'user' || line.isMeta === true || line.isSidechain === true) continue
    const text = userText((line.message as { content?: unknown } | undefined)?.content)
    if (text && !text.startsWith('<')) return text
  }
  // Older CLIs record the raw prompt on the queue-operation line instead.
  for (const line of lines) {
    if (line.type === 'queue-operation' && line.operation === 'enqueue') {
      const text = str(line.content)
      if (text && !text.startsWith('<')) return text
    }
  }
  return undefined
}

function hasToolResult(line: Record<string, unknown>): boolean {
  const content = (line.message as { content?: unknown } | undefined)?.content
  return Array.isArray(content)
    && content.some(block => (block as { type?: unknown })?.type === 'tool_result')
}

function userText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = str((block as { text?: unknown }).text)
      if (text) return text
    }
  }
  return undefined
}

/**
 * Replay the transcript through the live stdout normalizer — transcript
 * `user`/`assistant` lines share the stream-json envelope shape. Sidechain
 * (subagent) turns are dropped: they belong to their own transcripts.
 */
export async function readClaudeSession(
  record: LocalSessionRecord,
): Promise<NormalizedLogEntry[]> {
  const normalizer = new ClaudeLogNormalizer()
  const entries: NormalizedLogEntry[] = []

  for (const line of await readAllLines(record.path)) {
    if (line.isSidechain === true || line.isMeta === true) continue
    if (typeof line.type !== 'string' || !NORMALIZABLE_TYPES.has(line.type)) continue

    // The live normalizer discards plain user echoes — BKD already recorded
    // the prompt it sent. An imported transcript is the only record there is,
    // so prompts are emitted here instead.
    if (line.type === 'user' && !hasToolResult(line)) {
      const text = userText((line.message as { content?: unknown } | undefined)?.content)
      if (text && !text.startsWith('<')) {
        entries.push({
          entryType: 'user-message',
          content: text,
          timestamp: str(line.timestamp),
        })
      }
      continue
    }

    const parsed = normalizer.parse(JSON.stringify(line))
    if (!parsed) continue
    entries.push(...(Array.isArray(parsed) ? parsed : [parsed]))
  }

  return entries
}
