import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { ProcessHandle } from '@/engines/process-handle'

/**
 * Wraps an SDK `Query` so `ProcessManager` can manage its lifecycle through
 * the narrow `ProcessHandle` contract.
 *
 * Lifecycle mapping:
 *   - `kill()` first call → `Query.interrupt()` (graceful stop, equivalent to SIGTERM)
 *   - `kill()` second call → `Query.close()` (force terminate, equivalent to SIGKILL)
 *   - further calls → no-op
 *   - `exited` → Promise resolved by the executor's consumer loop when the
 *     async generator finishes (normal result, thrown error, or post-interrupt
 *     settle). `0` for normal end, non-zero when SDK surfaces an error.
 *   - `pid` → undefined (SDK doesn't expose the child PID)
 */
export class SdkProcessHandle implements ProcessHandle {
  readonly pid: number | undefined = undefined
  readonly exited: Promise<number>

  private resolveExited!: (code: number) => void
  private killCount = 0
  private settled = false

  constructor(private readonly query: Query) {
    this.exited = new Promise<number>((resolve) => {
      this.resolveExited = resolve
    })
  }

  kill(_signal?: number): void {
    this.killCount += 1
    if (this.killCount === 1) {
      void this.query.interrupt().catch(() => {
        /* already interrupted / closed */
      })
      return
    }
    if (this.killCount === 2) {
      try {
        this.query.close()
      } catch {
        /* already closed */
      }
    }
    // 3+ calls: no-op
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
