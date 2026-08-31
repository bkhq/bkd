import type { NormalizedLogEntry } from '@/engines/types'

// ---------- Pure classification functions ----------

export function isTurnCompletionEntry(entry: NormalizedLogEntry): boolean {
  // Signals forwarded from a subagent end that subagent's turn, not the main
  // one. CLI 2.1.251 only ever emits a main-thread `result`, so this is
  // defence against a future CLI that forwards subagent-scoped completions.
  if (entry.metadata?.subagent) return false

  // Explicit signals set by the normalizer when it recognizes a turn-over
  // message. These cover:
  //  - Claude `type: 'result'` → turnCompleted + resultSubtype
  //  - Claude `type: 'system', subtype: 'session_state_changed', state: 'idle'`
  //    → turnCompleted (the SDK's "authoritative turn-over signal")
  //  - Codex normalizer setting turnCompleted on its own completions.
  // A looser fallback keyed on `metadata.duration` was removed: it duplicated
  // the result path and risked false positives on background task
  // notifications whose usage blocks also carry a duration_ms field.
  if (entry.metadata?.turnCompleted === true) return true
  if (entry.metadata && Object.hasOwn(entry.metadata, 'resultSubtype')) {
    return true
  }
  return false
}

export function isCancelledNoiseEntry(entry: NormalizedLogEntry): boolean {
  const subtype = entry.metadata?.resultSubtype
  if (typeof subtype !== 'string' || subtype !== 'error_during_execution') return false
  const raw = `${entry.content ?? ''} ${String(entry.metadata?.error ?? '')}`.toLowerCase()
  return (
    raw.includes('request was aborted') ||
    raw.includes('request interrupted by user') ||
    raw.includes('rust analyzer lsp crashed') ||
    raw.includes('rust-analyzer-lsp')
  )
}

/**
 * The live background task set, mirrored from the CLI's
 * `background_tasks_changed` event. `[]` means the last task drained;
 * `undefined` means this entry says nothing about background tasks.
 */
export function readBackgroundTaskIds(entry: NormalizedLogEntry): string[] | undefined {
  if (entry.metadata?.subtype !== 'background_tasks_changed') return undefined
  const ids = entry.metadata.backgroundTasks
  return Array.isArray(ids) ? (ids as string[]) : []
}

/**
 * The CLI re-emits `init` when it starts another turn on the same process —
 * what it does after a background task reports back. Mid-stream, that means a
 * turn we already settled is no longer over.
 */
export function isTurnRestartEntry(entry: NormalizedLogEntry): boolean {
  return entry.entryType === 'system-message' && entry.metadata?.subtype === 'init'
}
