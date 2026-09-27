import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CommandBuilder } from '@/engines/command'
import { safeEnv } from '@/engines/safe-env'
import { resolveCommand, runCommand, spawnNode } from '@/engines/spawn'
import type {
  EngineAvailability,
  EngineCapability,
  EngineExecutor,
  EngineModel,
  ExecutionEnv,
  FollowUpOptions,
  NormalizedLogEntry,
  SpawnedProcess,
  SpawnOptions,
} from '@/engines/types'
import { logger } from '@/logger'
import { CursorLogNormalizer } from './normalizer'

/** Used when `cursor-agent models` cannot be read. */
const FALLBACK_MODELS: EngineModel[] = [{ id: 'auto', name: 'Auto', isDefault: true }]

/**
 * Find the Cursor CLI. Only the legacy `cursor-agent` name is looked up: the
 * installer always creates it, while the primary `agent` name collides with
 * other CLIs (grok ships an `agent` alias too).
 */
function resolveBinary(): string | null {
  const fromPath = resolveCommand('cursor-agent')
  if (fromPath) return fromPath
  const home = process.env.HOME ?? ''
  if (!home) return null
  const local = join(home, '.local/bin/cursor-agent')
  return existsSync(local) ? local : null
}

/**
 * Headless CLI args for one turn. Cursor takes a single prompt per process and
 * exits when the turn ends. `--resume <id>` creates the session when the id is
 * unknown and resumes it otherwise, so the first turn passes BKD's
 * pre-generated id and follow-ups pass the stored one.
 */
export function buildCursorArgs(options: SpawnOptions & { sessionId?: string }): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    // No stdin control channel in headless mode, so tools cannot be approved
    // interactively — every policy runs with permissions bypassed.
    '--force',
    '--trust',
    '--workspace',
    options.workingDir,
  ]
  const sessionId = options.sessionId ?? options.externalSessionId
  if (sessionId) args.push('--resume', sessionId)
  if (options.model) args.push('--model', options.model)
  args.push(options.prompt)
  return args
}

/**
 * Read the model list out of `cursor-agent models` output:
 * `<id> - <label>`, with a trailing `(default)` / `(current, default)` marker.
 */
export function parseCursorModels(stdout: string): EngineModel[] {
  const models: EngineModel[] = []
  for (const raw of stdout.split('\n')) {
    const match = raw.trim().match(/^(\S+) - (.*)$/)
    if (!match) continue
    let name = match[2]!.trim()
    let isDefault = false
    const marker = name.match(/\(([^()]*)\)$/)
    if (marker && /\b(?:default|current)\b/.test(marker[1]!)) {
      isDefault = /\bdefault\b/.test(marker[1]!)
      name = name.slice(0, marker.index).trim()
    }
    models.push({ id: match[1]!, name, isDefault })
  }
  return models
}

/** Read the auth state out of `cursor-agent status --format json`. */
export function parseCursorStatus(stdout: string): EngineAvailability['authStatus'] {
  try {
    const parsed = JSON.parse(stdout) as { isAuthenticated?: unknown, status?: unknown }
    if (parsed.isAuthenticated === true || parsed.status === 'authenticated') return 'authenticated'
    if (parsed.isAuthenticated === false || parsed.status === 'unauthenticated') return 'unauthenticated'
  } catch {
    // not JSON
  }
  return 'unknown'
}

async function queryCursor(binaryPath: string, args: string[], label: string): Promise<string | null> {
  try {
    const { code, stdout } = await runCommand([binaryPath, ...args], {
      timeout: 15000,
      stderr: 'pipe',
      env: safeEnv({}, 'cursor'),
    })
    if (code === 0) return stdout
    logger.debug({ exitCode: code }, `cursor_${label}_unavailable`)
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, `cursor_${label}_failed`)
  }
  return null
}

export class CursorExecutor implements EngineExecutor {
  readonly engineType = 'cursor' as const
  readonly protocol = 'stream-json' as const
  readonly capabilities: EngineCapability[] = []

  async spawn(options: SpawnOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    return this.spawnProcess(buildCursorArgs(options), options, env, 'spawn')
  }

  async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    return this.spawnProcess(buildCursorArgs(options), options, env, 'followup')
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    logger.debug({ pid: spawnedProcess.subprocess.pid }, 'cursor_cancel_requested')
    // SIGTERM lets the CLI persist the session so the next follow-up can
    // resume it; SIGKILL only if it hangs.
    spawnedProcess.cancel()
    const timeout = setTimeout(() => {
      try {
        spawnedProcess.subprocess.kill(9)
      } catch {
        /* already dead */
      }
    }, 5000)
    try {
      await spawnedProcess.subprocess.exited
    } finally {
      clearTimeout(timeout)
    }
  }

  async getAvailability(): Promise<EngineAvailability> {
    const binaryPath = resolveBinary()
    if (!binaryPath) return { engineType: 'cursor', installed: false, authStatus: 'unknown' }

    try {
      const versionOut = await queryCursor(binaryPath, ['--version'], 'version')
      if (versionOut === null) return { engineType: 'cursor', installed: false, authStatus: 'unknown' }

      const version = versionOut.match(/(\d{4}\.\d{2}\.\d{2}[\w.-]*)/)?.[1]
      const statusOut = await queryCursor(binaryPath, ['status', '--format', 'json'], 'status')
      return {
        engineType: 'cursor',
        installed: true,
        version,
        binaryPath,
        authStatus: statusOut === null ? 'unknown' : parseCursorStatus(statusOut),
      }
    } catch (error) {
      return {
        engineType: 'cursor',
        installed: false,
        authStatus: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getModels(): Promise<EngineModel[]> {
    const binaryPath = resolveBinary()
    const out = binaryPath ? await queryCursor(binaryPath, ['models'], 'models') : null
    const models = out === null ? [] : parseCursorModels(out)
    return models.length > 0 ? models : FALLBACK_MODELS
  }

  private defaultNormalizer = new CursorLogNormalizer()

  normalizeLog(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return this.defaultNormalizer.parse(rawLine)
  }

  createNormalizer() {
    return new CursorLogNormalizer()
  }

  private async spawnProcess(
    args: string[],
    options: SpawnOptions,
    env: ExecutionEnv,
    mode: 'spawn' | 'followup',
  ): Promise<SpawnedProcess> {
    const builder = CommandBuilder.create(resolveBinary() ?? 'cursor-agent')
      .params(args)
      .cwd(options.workingDir)
    if (options.env) builder.envs(options.env)
    if (env.vars) builder.envs(env.vars)
    const resolved = await builder.resolve()

    logger.debug(
      { issueId: env.issueId, cwd: options.workingDir, program: resolved.resolvedPath, mode },
      `cursor_${mode}_command`,
    )

    // stdin must be closed: the CLI blocks on an inherited pipe.
    const proc = spawnNode([resolved.resolvedPath, ...resolved.args], {
      cwd: resolved.cwd ?? options.workingDir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv(resolved.env, 'cursor'),
    })

    return {
      subprocess: proc as unknown as SpawnedProcess['subprocess'],
      stdout: proc.stdout,
      stderr: proc.stderr,
      cancel: () => proc.kill(15),
      spawnCommand: [resolved.resolvedPath, ...resolved.args].join(' '),
    }
  }
}
