import { cacheDel } from '@/cache'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import type { EngineType, NormalizedLogEntry } from '@/engines/types'
import type { EngineContext } from './context'
import { getLogsFromDb } from './persistence/queries'
import { cancel } from './process/cancel'
import { getActiveProcesses, getActiveProcessForIssue } from './process/state'
import type { ManagedProcess } from './types'
import { isVisibleForMode, setIssueDevMode } from './utils/visibility'

const SLASH_COMMANDS_PREFIX = 'engine:slashCommands'

/** All known engine types for cache loading. */
const ALL_ENGINE_TYPES: EngineType[] = [
  'claude-code',
  'codex',
  'gemini',
  'echo',
]

/** Per-engine in-memory cache for slash commands from DB. */
const cachedSlashCommands = new Map<EngineType, string[]>()

/** DB key for engine-specific slash commands. */
export function slashCommandsKey(engineType: EngineType): string {
  return `${SLASH_COMMANDS_PREFIX}:${engineType}`
}

/** Load slash commands from DB into memory cache for all engines. Called on startup and after probe. */
export async function refreshSlashCommandsCache(): Promise<void> {
  await Promise.all(
    ALL_ENGINE_TYPES.map(async (et) => {
      const raw = await getAppSetting(slashCommandsKey(et))
      try {
        const commands = raw ? (JSON.parse(raw) as string[]) : null
        if (commands && commands.length > 0) {
          cachedSlashCommands.set(et, commands)
        } else {
          cachedSlashCommands.delete(et)
        }
      } catch {
        cachedSlashCommands.delete(et)
      }
    }),
  )
}

/** Refresh cache for a single engine type. */
export async function refreshSlashCommandsCacheForEngine(
  engineType: EngineType,
): Promise<void> {
  const raw = await getAppSetting(slashCommandsKey(engineType))
  try {
    const commands = raw ? (JSON.parse(raw) as string[]) : null
    if (commands && commands.length > 0) {
      cachedSlashCommands.set(engineType, commands)
    } else {
      cachedSlashCommands.delete(engineType)
    }
  } catch {
    cachedSlashCommands.delete(engineType)
  }
}

export function getCachedSlashCommands(engineType?: EngineType): string[] {
  if (engineType) return cachedSlashCommands.get(engineType) ?? []
  // Fallback: merge all engines (for backwards compat with global endpoint without engine param)
  const all: string[] = []
  for (const cmds of cachedSlashCommands.values()) {
    all.push(...cmds)
  }
  return all
}

/**
 * One-time migration: move legacy global `engine:slashCommands` key to
 * the per-engine key `engine:slashCommands:claude-code` (the only engine
 * that previously reported slash commands). Safe to call multiple times.
 */
export async function migrateSlashCommandsKey(): Promise<void> {
  const LEGACY_KEY = 'engine:slashCommands'
  const raw = await getAppSetting(LEGACY_KEY)
  if (!raw) return
  // Only migrate if the new per-engine key doesn't exist yet
  const existing = await getAppSetting(slashCommandsKey('claude-code'))
  if (existing) return
  await setAppSetting(slashCommandsKey('claude-code'), raw)
  // Clean up legacy key from DB
  const { db } = await import('@/db')
  const { appSettings } = await import('@/db/schema')
  const { eq } = await import('drizzle-orm')
  await db.delete(appSettings).where(eq(appSettings.key, LEGACY_KEY))
  await cacheDel(`app_setting:${LEGACY_KEY}`)
}

// ---------- Public read-only queries ----------

export function getLogs(
  ctx: EngineContext,
  issueId: string,
  devMode = false,
  opts?: {
    cursor?: string // ULID id — fetch entries after this
    before?: string // ULID id — fetch entries before this
    limit?: number
  },
): NormalizedLogEntry[] {
  setIssueDevMode(issueId, devMode)
  // DB pre-filters by visible + entryType; isVisibleForMode() handles subtype rules.
  const persisted = getLogsFromDb(issueId, devMode, opts)

  // When loading older entries (before cursor), skip in-memory merge —
  // in-memory logs are always the newest and irrelevant for historical pages.
  if (opts?.before) return persisted

  // While a process is active, merge any in-memory tail not yet persisted.
  const active = getActiveProcessForIssue(ctx, issueId)
  if (!active || active.logs.length === 0) {
    return persisted
  }

  const seen = new Set(
    persisted.map((entry) =>
      entry.messageId
        ? `id:${entry.messageId}`
        : `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`,
    ),
  )

  // Only merge in-memory entries that are NEWER than a lower bound.
  // The ring buffer can hold up to 10k entries while the DB page is
  // limited (e.g. 61). Including old ring buffer entries that simply
  // fell outside the DB page window would break sort order and cause
  // the route handler's slice logic to return stale messages.
  //
  // Lower bound selection:
  //   cursor mode  → entries must be after the cursor (forward pagination)
  //   reverse mode → entries must be after the DB page's newest entry
  //   neither      → no bound (include all ring buffer entries)
  const newestDbId =
    persisted.length > 0 ? persisted[persisted.length - 1].messageId : undefined
  const lowerBound = opts?.cursor ?? newestDbId

  const merged = [...persisted]
  for (const entry of active.logs.toArray()) {
    if (!isVisibleForMode(entry, devMode)) continue
    const key = entry.messageId
      ? `id:${entry.messageId}`
      : `${entry.turnIndex ?? 0}:${entry.timestamp ?? ''}:${entry.entryType}:${entry.content}`
    if (seen.has(key)) continue
    // Skip entries at or below the lower bound — they are persisted but
    // outside the page window. Including them would break chronological order.
    if (lowerBound && entry.messageId && entry.messageId <= lowerBound) continue
    seen.add(key)
    merged.push(entry)
  }

  // Final safety sort by messageId (ULID) to guarantee chronological order.
  // Entries without messageId (persist failures) sort to the end.
  merged.sort((a, b) => {
    if (a.messageId && b.messageId)
      return a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0
    if (a.messageId && !b.messageId) return -1
    if (!a.messageId && b.messageId) return 1
    return 0
  })

  return merged
}

export function getActiveProcessesList(ctx: EngineContext): ManagedProcess[] {
  return getActiveProcesses(ctx)
}

export function getProcess(
  ctx: EngineContext,
  executionId: string,
): ManagedProcess | undefined {
  return ctx.pm.get(executionId)?.meta
}

export function hasActiveProcessForIssue(
  ctx: EngineContext,
  issueId: string,
): boolean {
  return getActiveProcessForIssue(ctx, issueId) !== undefined
}

export function isTurnInFlight(ctx: EngineContext, issueId: string): boolean {
  const active = getActiveProcessForIssue(ctx, issueId)
  return !!active && active.turnInFlight
}

export function getSlashCommands(
  ctx: EngineContext,
  issueId: string,
  engineType?: EngineType,
): string[] {
  const active = getActiveProcessForIssue(ctx, issueId)
  if (active && active.slashCommands.length > 0) return active.slashCommands
  // Use the active process's engine type, or the caller-supplied one, for cache lookup
  const et = active?.engineType ?? engineType
  return getCachedSlashCommands(et)
}

export async function cancelAll(ctx: EngineContext): Promise<void> {
  const active = getActiveProcesses(ctx)
  await Promise.all(
    active.map((p) => cancel(ctx, p.executionId, { hard: true })),
  )
}
