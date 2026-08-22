import { stat } from 'node:fs/promises'

/**
 * Transcripts run to hundreds of megabytes across the corpus, so listing only
 * ever reads this much of each file. 256 KB is sized from the real corpus:
 * Codex writes a large `session_meta` (base instructions) and `world_state`
 * ahead of the first user message, and a smaller window left a third of the
 * sessions without a title.
 */
export const HEAD_BYTES = 256 * 1024

const TITLE_MAX_CHARS = 160

/** Parse the leading complete JSONL lines of a file, skipping malformed ones. */
export async function readHeadLines(path: string): Promise<Record<string, unknown>[]> {
  const text = await Bun.file(path).slice(0, HEAD_BYTES).text()
  const lines = text.split('\n')
  // The last line may be cut mid-object by the byte cap
  if (!text.endsWith('\n')) lines.pop()
  return parseLines(lines)
}

/** Parse every line of a file. Used for import, never for listing. */
export async function readAllLines(path: string): Promise<Record<string, unknown>[]> {
  const text = await Bun.file(path).text()
  return parseLines(text.split('\n'))
}

function parseLines(lines: string[]): Record<string, unknown>[] {
  const parsed: Record<string, unknown>[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line)
      if (value && typeof value === 'object') parsed.push(value as Record<string, unknown>)
    } catch {
      // Truncated or malformed line — skip, never fatal
    }
  }
  return parsed
}

export function toTitle(text: string | undefined): string {
  if (!text) return ''
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length > TITLE_MAX_CHARS ? `${collapsed.slice(0, TITLE_MAX_CHARS)}…` : collapsed
}

export async function fileStats(path: string): Promise<{ sizeBytes: number, lastActiveAt: string } | null> {
  try {
    const info = await stat(path)
    return { sizeBytes: info.size, lastActiveAt: info.mtime.toISOString() }
  } catch {
    return null
  }
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
