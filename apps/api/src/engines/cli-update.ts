import type { EngineUpdate } from '@bkd/shared'
import { UPDATABLE_ENGINES } from '@bkd/shared'
import { safeEnv } from '@/engines/safe-env'
import { spawnNode } from '@/engines/spawn'
import { getEngineDiscovery, setEngineVersion } from '@/engines/startup-probe'
import type { EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { readLines } from '@/skills/cli'
import { ulid } from 'ulid'

/*
 * Runs an engine CLI's own updater (`<binary> update`), one at a time. There is
 * no cancel: an interrupted self-update can leave a half-replaced install.
 * Afterwards only `<binary> --version` runs; a full probe would touch Claude's
 * OAuth credential.
 */

const TIMEOUT_MS = 10 * 60 * 1000
const MAX_OUTPUT_LINES = 500
const KEEP_UPDATES = 20

export type CliUpdateRunner = (
  argv: string[],
  options: { env: Record<string, string>, onLine: (line: string) => void, signal: AbortSignal },
) => Promise<number>

const spawnRunner: CliUpdateRunner = async (argv, { env, onLine, signal }) => {
  const proc = spawnNode(argv, { env, stdin: 'ignore' })
  const onAbort = () => proc.kill()
  signal.addEventListener('abort', onAbort)
  try {
    await Promise.all([readLines(proc.stdout, onLine), readLines(proc.stderr, onLine)])
    return await proc.exited
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

let runner: CliUpdateRunner = spawnRunner

/** Tests replace the CLI; `null` restores the real one. */
export function setCliUpdateRunner(next: CliUpdateRunner | null): void {
  runner = next ?? spawnRunner
}

export class CliUpdateError extends Error {
  constructor(message: string, readonly status: 400 | 409) {
    super(message)
  }
}

const updates = new Map<string, EngineUpdate>()
let current: EngineUpdate | null = null

export function getEngineUpdate(id: string): EngineUpdate | undefined {
  return updates.get(id)
}

export async function startEngineUpdate(engineType: EngineType): Promise<EngineUpdate> {
  if (!UPDATABLE_ENGINES.includes(engineType)) throw new CliUpdateError(`${engineType} has no updater`, 400)
  if (current) throw new CliUpdateError('Another update is running', 409)
  const engine = (await getEngineDiscovery()).engines.find(e => e.engineType === engineType)
  if (!engine?.installed || !engine.binaryPath) throw new CliUpdateError(`${engineType} is not installed`, 400)
  // Re-check: the discovery lookup above may have awaited a probe
  if (current) throw new CliUpdateError('Another update is running', 409)

  const op: EngineUpdate = {
    id: ulid(),
    engineType,
    status: 'running',
    output: [],
    error: null,
    fromVersion: engine.version ?? null,
    toVersion: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
  current = op
  updates.set(op.id, op)
  for (const id of [...updates.keys()].slice(0, Math.max(0, updates.size - KEEP_UPDATES))) updates.delete(id)

  void run(op, engine.binaryPath)
  return op
}

async function run(op: EngineUpdate, binary: string): Promise<void> {
  const abort = new AbortController()
  const timer = setTimeout(() => {
    op.error = 'Timed out after 10 minutes'
    abort.abort()
  }, TIMEOUT_MS)
  const env = safeEnv(undefined, op.engineType)
  const onLine = (line: string) => {
    op.output.push(line)
    if (op.output.length > MAX_OUTPUT_LINES) op.output.splice(0, op.output.length - MAX_OUTPUT_LINES)
  }

  try {
    const exitCode = await runner([binary, 'update'], { env, onLine, signal: abort.signal })
    if (abort.signal.aborted) {
      op.status = 'failed'
    } else if (exitCode !== 0) {
      op.status = 'failed'
      op.error = `Updater exited with code ${exitCode}`
    } else {
      const lines: string[] = []
      await runner([binary, '--version'], { env, onLine: l => lines.push(l), signal: abort.signal })
      const version = lines.join(' ').match(/(\d+\.\d+\.\d[\w.-]*)/)?.[1] ?? null
      if (version) await setEngineVersion(op.engineType, version)
      op.toVersion = version
      op.status = 'succeeded'
    }
  } catch (err) {
    op.status = 'failed'
    op.error = err instanceof Error ? err.message : String(err)
    logger.warn({ err, engineType: op.engineType }, 'engine_update_failed')
  } finally {
    clearTimeout(timer)
    op.finishedAt = new Date().toISOString()
    current = null
    logger.info({ id: op.id, engineType: op.engineType, status: op.status, from: op.fromVersion, to: op.toVersion }, 'engine_update_finished')
  }
}
