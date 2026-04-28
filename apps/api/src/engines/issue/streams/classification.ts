import type { NormalizedLogEntry } from '@/engines/types'

// ---------- Pure classification functions ----------

export function isTurnCompletionEntry(entry: NormalizedLogEntry): boolean {
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
