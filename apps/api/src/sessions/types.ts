import type { NormalizedLogEntry } from '@/engines/types'

export type LocalSessionEngine = 'claude-code' | 'codex'

/** Metadata for one engine session recorded on this host outside BKD. */
export interface LocalSession {
  engine: LocalSessionEngine
  sessionId: string
  /** Working directory the session ran in — decides whether resume will work */
  cwd: string
  /** First user prompt, truncated */
  title: string
  startedAt?: string
  /** Transcript file mtime */
  lastActiveAt: string
  sizeBytes: number
  gitBranch?: string
  cliVersion?: string
  model?: string
}

/**
 * Internal record. `path` is resolved by the scanner and never derived from
 * client input, so it must not cross the API boundary.
 */
export interface LocalSessionRecord extends LocalSession {
  path: string
}

export type SessionReader = (record: LocalSessionRecord) => Promise<NormalizedLogEntry[]>
