import { cacheDelByPrefix, cacheGetOrSet } from '@/cache'
import type { NormalizedLogEntry } from '@/engines/types'
import { deleteClaudeSession, listClaudeSessions, readClaudeSession } from './claude'
import { deleteCodexSession, listCodexSessions, readCodexSession } from './codex'
import type { LocalSessionEngine, LocalSessionRecord } from './types'

export type { LocalSession, LocalSessionEngine, LocalSessionRecord } from './types'

const LIST_CACHE_KEY = 'localSessions:all'
const LIST_TTL_SECONDS = 60

/**
 * Scan both engine homes. Listing is metadata-only (stat + bounded head read)
 * because the corpus routinely runs to hundreds of megabytes.
 */
export async function listLocalSessions(): Promise<LocalSessionRecord[]> {
  return cacheGetOrSet(LIST_CACHE_KEY, LIST_TTL_SECONDS, async () => {
    const [claude, codex] = await Promise.all([listClaudeSessions(), listCodexSessions()])
    return [...claude, ...codex].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  })
}

/**
 * Resolve a session by id. The on-disk path comes from the scan, never from
 * client input, so no path traversal is reachable through this API.
 */
export async function findLocalSession(
  engine: LocalSessionEngine,
  sessionId: string,
): Promise<LocalSessionRecord | null> {
  const sessions = await listLocalSessions()
  return sessions.find(s => s.engine === engine && s.sessionId === sessionId) ?? null
}

export async function readLocalSession(record: LocalSessionRecord): Promise<NormalizedLogEntry[]> {
  return record.engine === 'codex' ? readCodexSession(record) : readClaudeSession(record)
}

/**
 * Delete a session's files. The record comes from the scan, so the path is never
 * derived from client input. The listing cache is dropped so the row disappears
 * on the next fetch rather than lingering for the rest of its TTL.
 */
export async function deleteLocalSession(record: LocalSessionRecord): Promise<void> {
  if (record.engine === 'codex') await deleteCodexSession(record)
  else await deleteClaudeSession(record)
  await cacheDelByPrefix('localSessions:')
}
