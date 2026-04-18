import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  CanUseTool,
  Options,
  PermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk'
import { CommandBuilder } from '@/engines/command'
import { safeEnv } from '@/engines/safe-env'
import { spawnNode } from '@/engines/spawn'
import type {
  EngineAvailability,
  EngineCapability,
  EngineExecutor,
  EngineModel,
  ExecutionEnv,
  FollowUpOptions,
  NormalizedLogEntry,
  PermissionPolicy,
  SpawnedProcess,
  SpawnOptions,
} from '@/engines/types'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'
import { CLAUDE_MODELS, getClaudeAuthStatus, resolveClaudeBinary } from '../claude-shared/binary'
import { SdkProcessHandle } from './handle'
import { ClaudeSdkNormalizer, stringifyMessage } from './normalizer'
import { PushableStream } from './pushable-stream'

const ISSUE_LOG_DIR = join(ROOT_DIR, 'data', 'logs', 'issues')

const READ_ONLY_TOOLS = new Set(['Glob', 'Grep', 'NotebookRead', 'Read', 'Task', 'TodoWrite'])

/**
 * Map the app's `PermissionPolicy` to the SDK's `PermissionMode`.
 * - `auto` → `'auto'` (SDK's AI-classifier mode; identical semantics to legacy CLI `--permission-mode=auto`)
 * - `plan` → `'plan'` (planning mode; switches to `bypassPermissions` when ExitPlanMode triggers)
 * - `supervised` → `'default'` (SDK prompts for non-read tools; `canUseTool` decides)
 */
function mapPermissionMode(policy: PermissionPolicy | undefined): PermissionMode {
  switch (policy) {
    case 'plan':
      return 'plan'
    case 'supervised':
      return 'default'
    default:
      return 'auto'
  }
}

/**
 * Build the `canUseTool` callback.
 *
 * - Plan mode: ExitPlanMode is auto-approved with a `setMode` update back to
 *   `bypassPermissions` so Claude executes the plan freely afterwards. Other
 *   tools reaching the callback (shouldn't happen under `plan` mode normally)
 *   are allowed.
 * - Supervised mode: read-only tools allowed silently; any tool that reaches
 *   `canUseTool` is allowed (the web UI has no interactive approval flow).
 * - Auto mode: callback is unused because the SDK's AI classifier handles
 *   everything; we still return a safe allow for defensive reasons.
 */
function buildCanUseTool(policy: PermissionPolicy | undefined): CanUseTool {
  return async (toolName, input): Promise<PermissionResult> => {
    if (policy === 'plan' && toolName === 'ExitPlanMode') {
      return {
        behavior: 'allow',
        updatedInput: input,
        updatedPermissions: [
          { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
        ],
      }
    }

    if (policy === 'supervised' && !READ_ONLY_TOOLS.has(toolName)) {
      logger.debug({ toolName }, 'claude_sdk_supervised_tool_auto_allowed')
    }

    return { behavior: 'allow', updatedInput: input }
  }
}

function makeUserMessage(content: string): SDKUserMessage {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content,
    },
  }
}

/**
 * Create a push-only stderr `ReadableStream`. Constructed before `query()`
 * so the stderr callback we pass into the SDK can safely capture `push`
 * even if the SDK emits stderr synchronously during startup (binary
 * missing, config error, etc.) — no temporal-dead-zone on `bridge`.
 */
function createStderrStream(): {
  stream: ReadableStream<Uint8Array>
  push: (chunk: string) => void
  close: () => void
} {
  const encoder = new TextEncoder()
  const ref: { ctrl: ReadableStreamDefaultController<Uint8Array> | null } = { ctrl: null }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ref.ctrl = controller
    },
    cancel() {
      /* nothing to cancel — stderr is push-only */
    },
  })
  return {
    stream,
    push: (chunk: string) => {
      const ctrl = ref.ctrl
      if (!ctrl) return
      try {
        ctrl.enqueue(encoder.encode(chunk))
      } catch {
        /* stream closed */
      }
    },
    close: () => {
      try {
        ref.ctrl?.close()
      } catch {
        /* already closed */
      }
    },
  }
}

/**
 * Bridge the SDK `Query` async generator to the `(stdout, stderr)` stream pair
 * that `SpawnedProcess` + `consumeStream` expect. Keeps the legacy consumer
 * path unchanged during the migration.
 */
function startBridge(
  q: Query,
  label: string,
  issueId: string | undefined,
  stderr: { push: (chunk: string) => void, close: () => void },
): {
  handle: SdkProcessHandle
  stdout: ReadableStream<Uint8Array>
} {
  const handle = new SdkProcessHandle(q)

  const stdoutRef: { ctrl: ReadableStreamDefaultController<Uint8Array> | null } = { ctrl: null }
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      stdoutRef.ctrl = controller
    },
    cancel() {
      handle.kill()
    },
  })

  const encoder = new TextEncoder()

  void (async () => {
    let exitCode = 0
    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        const ctrl = stdoutRef.ctrl
        if (!ctrl) break
        try {
          ctrl.enqueue(encoder.encode(stringifyMessage(msg)))
        } catch {
          break
        }
      }
    } catch (err) {
      exitCode = 1
      logger.warn({ issueId, label, err }, 'claude_sdk_query_error')
      const message = err instanceof Error ? err.message : String(err)
      stderr.push(`${message}\n`)
    } finally {
      try {
        stdoutRef.ctrl?.close()
      } catch {
        /* already closed */
      }
      stderr.close()
      // If the handle was force-closed (SIGKILL equivalent) but the generator
      // still unwound without throwing, report a non-zero exit so
      // `monitorCompletion` treats the run as terminated rather than
      // successfully completed.
      if (exitCode === 0 && handle.wasHardClosed) {
        exitCode = 137
      }
      handle.settle(exitCode)
    }
  })()

  return { handle, stdout }
}

export class ClaudeCodeSdkExecutor implements EngineExecutor {
  readonly engineType = 'claude-code-sdk' as const
  readonly protocol = 'stream-json' as const
  readonly capabilities: EngineCapability[] = ['session-fork', 'context-usage', 'plan-mode']

  private readonly defaultNormalizer = new ClaudeSdkNormalizer()

  async spawn(options: SpawnOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    return this.startQuery(options, env, 'spawn', {})
  }

  async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    const extraOptions: Partial<Options> = { resume: options.sessionId }
    if (options.resetToMessageId) {
      extraOptions.resumeSessionAt = options.resetToMessageId
    }
    return this.startQuery(options, env, 'followup', extraOptions)
  }

  async cancel(spawnedProcess: SpawnedProcess): Promise<void> {
    if (spawnedProcess.protocolHandler) {
      await spawnedProcess.protocolHandler.interrupt()
    } else {
      spawnedProcess.cancel()
    }
  }

  async getAvailability(): Promise<EngineAvailability> {
    try {
      const binaryPath = resolveClaudeBinary()
      if (!binaryPath) {
        return {
          engineType: 'claude-code-sdk',
          installed: false,
          authStatus: 'unknown',
        }
      }

      const resolved = await CommandBuilder.create(binaryPath)
        .param('--version')
        .env('NPM_CONFIG_LOGLEVEL', 'error')
        .resolve()

      const proc = spawnNode([resolved.resolvedPath, ...resolved.args], {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: safeEnv(resolved.env, 'claude-code-sdk'),
      })

      const timer = setTimeout(() => proc.kill(), 10000)
      const exitCode = await proc.exited
      clearTimeout(timer)

      if (exitCode !== 0) {
        return { engineType: 'claude-code-sdk', installed: false, authStatus: 'unknown' }
      }

      const stdout = await new Response(proc.stdout).text()
      const version = stdout.match(/(\d+\.\d+\.\d[\w.-]*)/)?.[1]

      return {
        engineType: 'claude-code-sdk',
        installed: true,
        version,
        binaryPath,
        authStatus: getClaudeAuthStatus(),
      }
    } catch (error) {
      return {
        engineType: 'claude-code-sdk',
        installed: false,
        authStatus: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getModels(): Promise<EngineModel[]> {
    return CLAUDE_MODELS
  }

  normalizeLog(rawLine: string): NormalizedLogEntry | NormalizedLogEntry[] | null {
    return this.defaultNormalizer.parse(rawLine)
  }

  createNormalizer() {
    return new ClaudeSdkNormalizer()
  }

  /**
   * Discover slash-commands, agents, and plugins by issuing a dry query and
   * calling the SDK's `supportedCommands` / `supportedAgents`. Much faster
   * than the legacy one-shot CLI invocation: no subprocess start, just a
   * control request against an idle query.
   */
  async discoverSlashCommandsAndAgents(workingDir: string): Promise<{
    slashCommands: string[]
    agents: string[]
    plugins: Array<{ name: string, path: string }>
    initReceived: boolean
  }> {
    const binaryPath = resolveClaudeBinary()
    if (!binaryPath) {
      return { slashCommands: [], agents: [], plugins: [], initReceived: false }
    }

    const pushable = new PushableStream<SDKUserMessage>()
    let q: Query | null = null

    try {
      q = query({
        prompt: pushable,
        options: {
          cwd: workingDir,
          pathToClaudeCodeExecutable: binaryPath,
          executable: 'bun',
          env: safeEnv(undefined, 'claude-code-sdk') as unknown as Record<string, string>,
          permissionMode: 'auto',
          disallowedTools: ['AskUserQuestion'],
          settingSources: ['user', 'project', 'local'],
        },
      })

      const [commandsResult, agentsResult] = await Promise.all([
        withTimeout(q.supportedCommands(), 15_000, null as SlashCommand[] | null),
        withTimeout(q.supportedAgents(), 15_000, null as Array<{ name: string }> | null),
      ])

      // Require BOTH SDK calls to complete (not time out) before treating
      // discovery as authoritative. Empty-but-completed lists are fine — they
      // mean "no commands/agents in this workspace" and should still clear
      // stale cache entries. But if one call times out while the other
      // returns, we cannot safely overwrite the prior cache for the failed
      // field without erasing valid metadata, so we report `initReceived:
      // false` and let `startup-probe` keep the previously cached values.
      const initReceived = commandsResult !== null && agentsResult !== null

      return {
        slashCommands: (commandsResult ?? []).map(c => c.name),
        agents: (agentsResult ?? []).map(a => a.name),
        plugins: [],
        initReceived,
      }
    } catch (error) {
      logger.warn({ error, workingDir }, 'claude_sdk_discover_failed')
      return { slashCommands: [], agents: [], plugins: [], initReceived: false }
    } finally {
      pushable.close()
      try {
        q?.close()
      } catch {
        /* already closed */
      }
    }
  }

  // ---------- Private ----------

  private async startQuery(
    options: SpawnOptions,
    env: ExecutionEnv,
    label: 'spawn' | 'followup',
    extra: Partial<Options>,
  ): Promise<SpawnedProcess> {
    // Prefer an externally-resolved binary (e.g. /work/bin/claude or a user
    // install) when present. When absent, leave `pathToClaudeCodeExecutable`
    // undefined so the SDK falls back to resolving `@anthropic-ai/claude-code`
    // from its own dependency graph. This keeps the engine usable in
    // deployments that ship only the SDK + peer package without a separate
    // global `claude` binary.
    const binaryPath = resolveClaudeBinary()

    const permissionMode = options.permissionMode ?? 'auto'
    const sdkPermissionMode = mapPermissionMode(permissionMode)

    const extraArgs: Record<string, string | null> = {}
    if (options.externalSessionId) {
      extraArgs['session-id'] = options.externalSessionId
    }
    if (options.agent) {
      extraArgs.agent = options.agent
    }

    // Merge user/project env vars and run them through safeEnv so protected
    // keys (PATH, HOME, ANTHROPIC_API_KEY, IS_SANDBOX, …) cannot be overridden.
    // `env.vars` wins over `options.env` to match the precedence used by the
    // legacy executor (per-execution env > project env).
    const userExtra: Record<string, string> = { ...(options.env ?? {}), ...(env.vars ?? {}) }
    const sdkOptions: Options = {
      cwd: options.workingDir,
      ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {}),
      executable: 'bun',
      env: {
        ...safeEnv(userExtra, 'claude-code-sdk'),
        NPM_CONFIG_LOGLEVEL: 'error',
        IS_SANDBOX: '1',
      },
      permissionMode: sdkPermissionMode,
      canUseTool: buildCanUseTool(permissionMode),
      disallowedTools: ['AskUserQuestion'],
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: false,
      ...extra,
    }

    if (sdkPermissionMode === 'bypassPermissions' || sdkPermissionMode === 'plan') {
      sdkOptions.allowDangerouslySkipPermissions = true
    }

    if (options.model && options.model !== 'auto') {
      sdkOptions.model = options.model
    }

    if (Object.keys(extraArgs).length > 0) {
      sdkOptions.extraArgs = extraArgs
    }

    const logLevel = process.env.LOG_LEVEL ?? 'info'
    if (env.issueId && (logLevel === 'debug' || logLevel === 'trace')) {
      try {
        const issueLogDir = join(ISSUE_LOG_DIR, env.issueId)
        mkdirSync(issueLogDir, { recursive: true })
        sdkOptions.debug = true
        sdkOptions.debugFile = join(issueLogDir, 'claude-debug.log')
      } catch {
        /* best-effort */
      }
    }

    const pushable = new PushableStream<SDKUserMessage>()
    pushable.push(makeUserMessage(options.prompt))

    // Create the stderr stream BEFORE `query()` so the stderr callback we pass
    // into the SDK can safely reference `stderr.push` even if the SDK emits
    // stderr synchronously during startup (e.g. immediate binary/config
    // errors). Referencing the bridge here would hit the temporal dead zone.
    const stderr = createStderrStream()

    const q = query({
      prompt: pushable,
      options: {
        ...sdkOptions,
        stderr: (data) => {
          stderr.push(data.endsWith('\n') ? data : `${data}\n`)
        },
      },
    })

    const bridge = startBridge(q, label, env.issueId, stderr)

    logger.debug(
      {
        issueId: env.issueId,
        label,
        binaryPath,
        cwd: options.workingDir,
        permissionMode: sdkPermissionMode,
        resume: extra.resume,
        resumeSessionAt: extra.resumeSessionAt,
      },
      'claude_sdk_query_started',
    )

    return {
      subprocess: bridge.handle as unknown as SpawnedProcess['subprocess'],
      stdout: bridge.stdout,
      stderr: stderr.stream,
      cancel: () => {
        // Soft cancel: interrupt the current turn but keep the prompt stream
        // open so follow-up turns via `protocolHandler.sendUserMessage` remain
        // deliverable. `protocolHandler.close()` is the explicit shutdown that
        // closes the pushable and the underlying query.
        bridge.handle.kill()
      },
      protocolHandler: {
        interrupt: async () => {
          try {
            await q.interrupt()
          } catch {
            /* already interrupted */
          }
        },
        close: () => {
          pushable.close()
          try {
            q.close()
          } catch {
            /* already closed */
          }
        },
        sendUserMessage: (content) => {
          pushable.push(makeUserMessage(content))
        },
      },
      spawnCommand: `[claude-sdk] ${binaryPath} (${label}${extra.resume ? ` resume=${extra.resume}` : ''})`,
    }
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await new Promise<T>((resolve) => {
    const timer = setTimeout(resolve, ms, fallback)
    p.then((v) => {
      clearTimeout(timer)
      resolve(v)
    }).catch(() => {
      clearTimeout(timer)
      resolve(fallback)
    })
  })
}
