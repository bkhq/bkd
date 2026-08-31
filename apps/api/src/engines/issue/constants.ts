export const DEFAULT_LOG_PAGE_SIZE = 10
export const LOG_PAGE_SIZE_KEY = 'log:pageSize'
export const MAX_LOG_ENTRIES = 10000
export const AUTO_CLEANUP_DELAY_MS = 5 * 60 * 1000 // 5 minutes
export const MAX_AUTO_RETRIES = 1
// Stall detection timeline:
//   T+3m: first check — if process alive, wait for CLI internal retry
//   T+5m: second check (process alive 2min after first probe) — send interrupt
//   T+7m: no response after interrupt — force kill
export const GC_INTERVAL_MS = 60 * 1000 // 1 minute — frequent stall detection
export const MAX_CONCURRENT_EXECUTIONS = Number(process.env.MAX_CONCURRENT_EXECUTIONS) || 5
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
export const STREAM_STALL_TIMEOUT_MS = 3 * 60 * 1000 // 3 minutes — check process liveness (non-destructive)
export const STALL_LIVENESS_GRACE_MS = 2 * 60 * 1000 // 2 minutes — wait for CLI internal retry before sending interrupt
export const STALL_INTERRUPT_GRACE_MS = 2 * 60 * 1000 // 2 minutes — kill process if no response after interrupt
export const CANCEL_RESPONSE_TIMEOUT_MS = 5_000 // 5s — wait for turn completion after each interrupt retry
export const CANCEL_MAX_RETRIES = 3 // send interrupt up to 3 times before hard kill (worst case: 3 × 5s = 15s)
// Background-task settlement hold (ENG-036). A CLI that is running background
// tasks emits a `result` for the current turn and then, once a task reports
// back, starts another turn on the same process. Settling on the first result
// drops the issue into 'review' while the engine is still working.
export const BG_TASK_DRAIN_GRACE_MS = 3_000 // wait for the follow-up turn after the last task drains
export const BG_TASK_HOLD_MS = 10 * 60 * 1000 // cap: stop waiting on tasks that never report back
export const KEEPALIVE_STALL_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes — stall detection for keepAlive processes
export const WORKTREE_DIR = process.env.WORKTREE_DIR || 'worktrees'
