import type { NormalizedLogEntry } from '@bkd/shared'

/**
 * In-memory log of one execution's normalized entries, in arrival order.
 * `getLogs()` merges it with the DB so entries not yet persisted are visible.
 */
export class ExecutionStore {
  private entries: NormalizedLogEntry[] = []
  private destroyed = false

  constructor(readonly executionId: string) {}

  push(entry: NormalizedLogEntry): void {
    if (!this.destroyed) this.entries.push(entry)
  }

  toArray(): NormalizedLogEntry[] {
    return [...this.entries]
  }

  get length(): number {
    return this.entries.length
  }

  destroy(): void {
    this.destroyed = true
    this.entries = []
  }
}
