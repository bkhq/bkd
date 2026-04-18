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
 *     (graceful stop). A soft kill is deduped only while its own
 *     `interrupt()` RPC is still in-flight; once that promise settles, a
 *     subsequent soft kill fires a fresh interrupt. This preserves the retry
 *     behavior of `engines/issue/orchestration/cancel.ts` (which calls
 *     `cancel()` up to `CANCEL_MAX_RETRIES` times before hard-killing) and
 *     lets users interrupt later turns of a long-lived SDK session after an
 *     earlier cancel. A hard-closed handle rejects further soft kills.
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
  private softInterruptInFlight = false
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
    if (this.hardClosed || this.softInterruptInFlight) return
    this.softInterruptInFlight = true
    void this.query
      .interrupt()
      .catch(() => {
        /* already interrupted / closed */
      })
      .finally(() => {
        this.softInterruptInFlight = false
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

  /**
   * `true` if a hard close (signal 9) has been requested. The bridge uses this
   * to surface a non-zero exit code even when the generator finishes cleanly
   * after the close, so `monitorCompletion` treats the run as forced-terminated
   * rather than successfully completed.
   */
  get wasHardClosed(): boolean {
    return this.hardClosed
  }
}
