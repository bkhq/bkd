import { ProcessManager } from '@/engines/process-manager'
import type { EngineAttachment, PermissionPolicy } from '@/engines/types'
import { AUTO_CLEANUP_DELAY_MS } from './constants'
import type { ManagedProcess } from './types'

// ---------- EngineContext ----------

export interface EngineContext {
  readonly pm: ProcessManager<ManagedProcess>
  readonly issueOpLocks: Map<string, Promise<void>>
  readonly entryCounters: Map<string, number>
  readonly turnIndexes: Map<string, number>
  readonly userMessageIds: Map<string, string>
  readonly lastErrors: Map<string, string>
  /** Per-issue lock queue depth tracking. */
  readonly lockDepth: Map<string, number>
  /** Injected function reference — breaks lifecycle → orchestration cycle. */
  followUpIssue:
    | ((
      issueId: string,
      prompt: string,
      model?: string,
      permissionMode?: PermissionPolicy,
      busyAction?: 'queue' | 'cancel',
      displayPrompt?: string,
      metadata?: Record<string, unknown>,
      opts?: { skipPersistMessage?: boolean },
      attachments?: EngineAttachment[],
    ) => Promise<{ executionId: string, messageId?: string | null }>) |
    null
}

export function createEngineContext(): EngineContext {
  const pm = new ProcessManager<ManagedProcess>('mcp-issue', {
    maxConcurrent: 5,
    autoCleanupDelayMs: AUTO_CLEANUP_DELAY_MS,
    gcIntervalMs: 0,
    killTimeoutMs: 30_000,
  })
  return {
    pm,
    issueOpLocks: new Map(),
    entryCounters: new Map(),
    turnIndexes: new Map(),
    userMessageIds: new Map(),
    lastErrors: new Map(),
    lockDepth: new Map(),
    followUpIssue: null,
  }
}
