import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import type { EngineContext } from '@/engines/issue/context'
import { emitDiagnosticLog, emitErrorLog } from '@/engines/issue/diagnostic'
import { emitStateChange } from '@/engines/issue/events'
import { monitorCompletion } from '@/engines/issue/lifecycle/completion-monitor'
import { handleTurnCompleted } from '@/engines/issue/lifecycle/turn-completion'
import { ensureNoActiveProcess } from '@/engines/issue/process/guards'
import { withIssueLock } from '@/engines/issue/process/lock'
import { register } from '@/engines/issue/process/register'
import { persistUserMessage } from '@/engines/issue/user-message'
import { getPermissionOptions, resolveExecEnvVars } from '@/engines/issue/utils/helpers'
import { createLogNormalizer } from '@/engines/issue/utils/normalizer'
import { getPidFromSubprocess } from '@/engines/issue/utils/pid'
import { createWorktree } from '@/engines/issue/utils/worktree'
import { resolveExecutionModel } from '@/engines/model-resolver'
import type { EngineType, PermissionPolicy, SpawnedProcess } from '@/engines/types'
import { logger } from '@/logger'
import { ROOT_DIR } from '@/root'

export async function executeIssue(
  ctx: EngineContext,
  issueId: string,
  opts: {
    engineType: EngineType
    /** Virtual engine id to persist (string), clear (null), or leave as-is (undefined). */
    engineProfileId?: string | null
    prompt: string
    workingDir?: string
    model?: string
    permissionMode?: PermissionPolicy
    envVars?: Record<string, string>
    displayPrompt?: string
    metadata?: Record<string, unknown>
  },
): Promise<{ executionId: string, messageId?: string | null }> {
  return withIssueLock(ctx, issueId, async () => {
    logger.debug(
      {
        issueId,
        engineType: opts.engineType,
        model: opts.model,
        hasWorkingDir: !!opts.workingDir,
      },
      'issue_execute_requested',
    )
    const issue = await getIssueWithSession(issueId)
    if (!issue) throw new Error(`Issue not found: ${issueId}`)
    ensureNoActiveProcess(ctx, issueId)

    const executor = engineRegistry.get(opts.engineType)
    if (!executor) throw new Error(`No executor for engine type: ${opts.engineType}`)

    // Guard: reject engines that are registered but not yet executable.
    const avail = await executor.getAvailability()
    if (avail.executable === false) {
      throw new Error(`Engine '${opts.engineType}' is not yet executable (spawn not implemented)`)
    }

    // Resolve the effective virtual profile under the issue lock to avoid a
    // race between concurrent execute requests targeting different engines.
    const effectiveProfileId = opts.engineProfileId !== undefined
      ? opts.engineProfileId
      : issue.engineProfileId

    // 'auto' or a model missing from the engine's list resolves to the
    // engine's default model for the spawn. DB keeps the raw selection.
    const rawModel = opts.model === 'auto' ? undefined : opts.model
    const model = await resolveExecutionModel(opts.engineType, opts.model, effectiveProfileId)
    await updateIssueSession(issueId, {
      engineType: opts.engineType,
      sessionStatus: 'running',
      prompt: opts.prompt,
      model: rawModel ?? undefined,
      ...(opts.engineProfileId !== undefined ? { engineProfileId: opts.engineProfileId } : {}),
    })

    const baseDir = opts.workingDir ?? ROOT_DIR
    let workingDir = baseDir
    let worktreePath: string | undefined

    if (issue.useWorktree) {
      try {
        worktreePath = await createWorktree(baseDir, issue.projectId, issueId)
        workingDir = worktreePath
      } catch (error) {
        logger.warn({ issueId, error }, 'worktree_creation_failed_fallback_to_base')
      }
    }

    const permOptions = getPermissionOptions(opts.engineType, opts.permissionMode)
    const externalSessionId = crypto.randomUUID()
    const executionId = crypto.randomUUID()

    // Merge virtual-engine preset env vars (if this issue runs a virtual engine).
    const envVars = await resolveExecEnvVars(effectiveProfileId, opts.envVars)

    let spawned: SpawnedProcess
    try {
      spawned = await executor.spawn(
        {
          workingDir,
          prompt: opts.prompt,
          model,
          permissionMode: permOptions.permissionMode,
          externalSessionId,
        },
        {
          vars: envVars ?? {},
          workingDir,
          projectId: issue.projectId,
          issueId,
        },
      )
    } catch (spawnError) {
      logger.error(
        { issueId, executionId, err: spawnError },
        'execute_spawn_failed_reverting_session',
      )
      const errorMsg = spawnError instanceof Error ? spawnError.message : String(spawnError)
      emitDiagnosticLog(
        issueId,
        executionId,
        `[BKD] Process spawn failed: ${errorMsg}`,
        { event: 'spawn_failed' },
      )
      emitErrorLog(issueId, executionId, errorMsg)
      await updateIssueSession(issueId, { sessionStatus: 'failed' }).catch(e =>
        logger.error({ issueId, err: e }, 'execute_spawn_failed_revert_session_error'),
      )
      emitStateChange(issueId, executionId, 'failed')
      throw spawnError
    }

    // Allow executor to override the external session ID (e.g. Codex uses server-generated thread IDs)
    const finalExternalSessionId = spawned.externalSessionId ?? externalSessionId
    await updateIssueSession(issueId, {
      externalSessionId: finalExternalSessionId,
    })
    const pid = getPidFromSubprocess(spawned.subprocess)
    logger.info(
      {
        issueId,
        executionId,
        pid,
        engineType: opts.engineType,
        externalSessionId: finalExternalSessionId,
        worktreePath,
      },
      'issue_execute_spawned',
    )
    const normalizer = createLogNormalizer(executor)

    register(
      ctx,
      executionId,
      issueId,
      opts.engineType,
      spawned,
      line => normalizer.parse(line),
      0,
      worktreePath,
      () => handleTurnCompleted(ctx, issueId, executionId),
      worktreePath ? baseDir : undefined,
      workingDir,
      finalExternalSessionId,
      issue.keepAlive,
    )
    emitDiagnosticLog(
      issueId,
      executionId,
      `[BKD] Process spawned (engine=${opts.engineType}, pid=${pid}, model=${model ?? 'default'})`,
      { event: 'process_spawned', pid, engineType: opts.engineType, model },
    )
    const messageId = persistUserMessage(ctx, issueId, executionId, opts.prompt, opts.displayPrompt, opts.metadata)
    monitorCompletion(ctx, executionId, issueId, opts.engineType, false)

    return { executionId, messageId }
  })
}
