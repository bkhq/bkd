/**
 * Minimal process handle contract consumed by ProcessManager.
 *
 * PM manages lifecycle (pid logging, wait-for-exit, kill on timeout), not I/O.
 * Narrowing PM's dependency from Bun's `Subprocess` to this interface lets
 * non-subprocess backends (e.g. the Claude Agent SDK's `Query`) plug in via a
 * thin wrapper without faking full Subprocess semantics.
 *
 * `Bun.Subprocess` and the `Subprocess` shape returned by `spawnNode()` both
 * already satisfy this interface structurally.
 */
export interface ProcessHandle {
  readonly pid?: number
  readonly exited: Promise<number>
  kill: (signal?: number) => void
}
