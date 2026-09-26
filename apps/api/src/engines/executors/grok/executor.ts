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
import { GrokLogNormalizer } from './normalizer'

/** Used when `grok models` cannot be read. */
const FALLBACK_MODELS: EngineModel[] = [{ id: 'grok-4.7', name: 'grok-4.7', isDefault: true }]

/**
 * Find the `grok` binary: PATH first, then the installer's locations
 * (`~/.local/bin` symlink, `~/.grok/bin`).
 */
function resolveBinary(): string | null {
  const fromPath = resolveCommand('grok')
  if (fromPath) return fromPath
  const home = process.env.HOME ?? ''
  if (!home) return null
  return [join(home, '.local/bin/grok'), join(home, '.grok/bin/grok')].find(p => existsSync(p)) ?? null
}

/**
 * Headless CLI args for one turn. Grok takes a single prompt per process and
 * exits when the turn ends; a follow-up resumes the same session with `-r`.
 */
export function buildGrokArgs(options: SpawnOptions & { sessionId?: string }): string[] {
  const args = [
    '-p',
    options.prompt,
    '--output-format',
    'streaming-messages-json',
    // stream_event message_delta carries per-call usage for the context meter
    '--include-partial-messages',
    // No stdin control channel in headless mode, so tools cannot be approved
    // interactively — every policy runs with permissions bypassed.
    '--permission-mode',
    'bypassPermissions',
    '--cwd',
    options.workingDir,
  ]
  if (options.model && options.model !== 'auto') args.push('-m', options.model)
  if (options.agent) args.push('--agent', options.agent)
  if (options.sessionId) {
    args.push('-r', options.sessionId)
  } else if (options.externalSessionId) {
    args.push('-s', options.externalSessionId)
  }
  return args
}

/** Read auth status and the model list out of `grok models` output. */
export function parseGrokModels(stdout: string): {
  authStatus: EngineAvailability['authStatus']
  models: EngineModel[]
} {
  const authStatus = /not authenticated/i.test(stdout)
    ? 'unauthenticated'
    : /logged in/i.test(stdout) ? 'authenticated' : 'unknown'
  const models: EngineModel[] = []
  for (const match of stdout.matchAll(/^\s+([*-])\s+(\S+)/gm)) {
    models.push({ id: match[2]!, name: match[2]!, isDefault: match[1] === '*' })
  }
  return { authStatus, models }
}

async function queryGrokModels(binaryPath: string): Promise<ReturnType<typeof parseGrokModels> | null> {
  try {
    const { code, stdout } = await runCommand([binaryPath, 'models'], {
      timeout: 15000,
      stderr: 'pipe',
      env: safeEnv({ GROK_DISABLE_AUTOUPDATER: '1' }, 'grok'),
    })
    if (code === 0) return parseGrokModels(stdout)
    logger.debug({ exitCode: code }, 'grok_models_unavailable')
  } catch (error) {
    logger.debug({ error: error instanceof Error ? error.message : String(error) }, 'grok_models_failed')
  }
  return null
}

export class GrokExecutor implements EngineExecutor {
  readonly engineType = 'grok' as const
  readonly protocol = 'stream-json' as const
  readonly capabilities: EngineCapability[] = ['context-usage']

  async spawn(options: SpawnOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    return this.spawnProcess(buildGrokArgs(options), options, env, 'spawn')
  }

  async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    return this.spawnProcess(buildGrokArgs(options), options, env, 'followup')
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    logger.debug({ pid: spawnedProcess.subprocess.pid }, 'grok_cancel_requested')
    // SIGTERM lets grok save the session up to the last completed tool call
    // so the next follow-up can resume it; SIGKILL only if it hangs.
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
    if (!binaryPath) return { engineType: 'grok', installed: false, authStatus: 'unknown' }

    try {
      const { code, stdout } = await runCommand([binaryPath, '--version'], {
        timeout: 10000,
        stderr: 'pipe',
        env: safeEnv({ GROK_DISABLE_AUTOUPDATER: '1' }, 'grok'),
      })
      if (code !== 0) return { engineType: 'grok', installed: false, authStatus: 'unknown' }

      const version = stdout.match(/(\d+\.\d+\.\d[\w.-]*)/)?.[1]
      const models = await queryGrokModels(binaryPath)
      return {
        engineType: 'grok',
        installed: true,
        version,
        binaryPath,
        authStatus: models?.authStatus ?? 'unknown',
      }
    } catch (error) {
      return {
        engineType: 'grok',
        installed: false,
        authStatus: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getModels(): Promise<EngineModel[]> {
    const binaryPath = resolveBinary()
    const parsed = binaryPath ? await queryGrokModels(binaryPath) : null
    return parsed?.models.length ? parsed.models : FALLBACK_MODELS
  }

  private defaultNormalizer = new GrokLogNormalizer()

  normalizeLog(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return this.defaultNormalizer.parse(rawLine)
  }

  createNormalizer() {
    return new GrokLogNormalizer()
  }

  private async spawnProcess(
    args: string[],
    options: SpawnOptions,
    env: ExecutionEnv,
    mode: 'spawn' | 'followup',
  ): Promise<SpawnedProcess> {
    const builder = CommandBuilder.create(resolveBinary() ?? 'grok')
      .params(args)
      .env('GROK_DISABLE_AUTOUPDATER', '1')
      .cwd(options.workingDir)
    if (options.env) builder.envs(options.env)
    if (env.vars) builder.envs(env.vars)
    const resolved = await builder.resolve()

    logger.debug(
      { issueId: env.issueId, cwd: options.workingDir, program: resolved.resolvedPath, mode },
      `grok_${mode}_command`,
    )

    const proc = spawnNode([resolved.resolvedPath, ...resolved.args], {
      cwd: resolved.cwd ?? options.workingDir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: safeEnv(resolved.env, 'grok'),
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
