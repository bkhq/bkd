import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ProcessHandle } from '@/engines/process-handle'

/**
 * Wraps an SDK `Query` so `ProcessManager` can manage its lifecycle through
 * the narrow `ProcessHandle` contract.
 *
 * Lifecycle mapping:
 *   - `kill(9)` (SIGKILL) → immediate `Query.close()` (force terminate). Used by
 *     `ProcessManager.forceKill()` and the post-timeout escalation in
 *     `ProcessManager.terminate()`. A second SIGKILL is a no-op.
 *   - `kill()` / `kill(non-9)` (SIGTERM-equivalent) → `Query.interrupt()`
 *     (graceful stop). Subsequent soft kills are no-ops while the query is
 *     still alive; once interrupted, a later `kill(9)` still hard-closes.
 *   - `exited` → resolved by the executor's consumer loop via `settle()` when
 *     the async generator finishes (normal result, thrown error, or
 *     post-interrupt/post-close settle). `0` for normal end, non-zero when the
 *     SDK surfaces an error.
 *   - `pid` → undefined (SDK doesn't expose the child PID). Stall GC should
 *     use `isAlive()` instead.
 */
export class SdkProcessHandle implements ProcessHandle {
  readonly pid: number | undefined = undefined
  readonly exited: Promise<number>

  private resolveExited!: (code: number) => void
  private softInterrupted = false
  private hardClosed = false
  private settled = false

  constructor(private readonly query: Query) {
    this.exited = new Promise<number>((resolve) => {
      this.resolveExited = resolve
    })
  }

  kill(signal?: number): void {
    if (signal === 9) {
      if (this.hardClosed) return
      this.hardClosed = true
      try {
        this.query.close()
      } catch {
        /* already closed */
      }
      return
    }
    if (this.softInterrupted || this.hardClosed) return
    this.softInterrupted = true
    void this.query.interrupt().catch(() => {
      /* already interrupted / closed */
    })
  }

  /**
   * Liveness probe for stall GC. `pid` is always undefined for SDK handles, so
   * `process.kill(pid, 0)` isn't usable. We report alive until the consumer
   * loop settles (which happens on normal end, error, or after `close()`).
   */
  isAlive(): boolean {
    return !this.settled
  }

  /**
   * Called by the executor when the generator loop finishes. Idempotent —
   * only the first call resolves the `exited` promise.
   */
  settle(exitCode: number): void {
    if (this.settled) return
    this.settled = true
    this.resolveExited(exitCode)
  }

  get isSettled(): boolean {
    return this.settled
  }
}
