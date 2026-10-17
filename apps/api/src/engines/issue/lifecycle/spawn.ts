import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import type { EngineContext } from '@/engines/issue/context'
import { emitDiagnosticLog, emitErrorLog } from '@/engines/issue/diagnostic'
import { emitStateChange } from '@/engines/issue/events'
import { getNextTurnIndex, removeLogEntry } from '@/engines/issue/persistence/queries'
import {
  ensureNoActiveProcess,
  killExistingSubprocessForIssue,
} from '@/engines/issue/process/guards'
import { killUnregistered, register } from '@/engines/issue/process/register'
import { persistUserMessage } from '@/engines/issue/user-message'
import {
  getPermissionOptions,
  getProjectExecContext,
  isMissingExternalSessionError,
  resolveExecEnvVars,
  resolveWorkingDir,
} from '@/engines/issue/utils/helpers'
import { createLogNormalizer } from '@/engines/issue/utils/normalizer'
import { getPidFromSubprocess } from '@/engines/issue/utils/pid'
import { ensureAdmittedWorktree } from '@/engines/issue/utils/worktree'
import { resolveExecutionModel } from '@/engines/model-resolver'
import type { EngineType, PermissionPolicy, SpawnedProcess } from '@/engines/types'
import { logger } from '@/logger'
import { monitorCompletion } from './completion-monitor'
import { makeStreamHooks } from './turn-completion'

// ---------- Spawn helpers ----------

/** Persist the session id of a just-spawned process; kill the process if that fails. */
async function saveExternalSessionId(
  issueId: string,
  spawned: SpawnedProcess,
  externalSessionId: string,
): Promise<void> {
  try {
    await updateIssueSession(issueId, { externalSessionId })
  } catch (error) {
    killUnregistered(issueId, '', spawned)
    throw error
  }
}

/**
 * Try spawnFollowUp; if the external session is missing, fall back to a fresh spawn.
 */
export async function spawnWithSessionFallback(
  executor: ReturnType<typeof engineRegistry.get> & object,
  issueId: string,
  opts: {
    workingDir: string
    prompt: string
    sessionId: string
    model?: string
    permissionMode: PermissionPolicy
    projectId: string
    envVars?: Record<string, string>
    extraArgs?: string[]
    systemPrompt?: string
  },
): Promise<SpawnedProcess> {
  const spawnCtx = {
    vars: opts.envVars ?? {},
    workingDir: opts.workingDir,
    projectId: opts.projectId,
    issueId,
    extraArgs: opts.extraArgs,
  }
  try {
    return await executor.spawnFollowUp(
      {
        workingDir: opts.workingDir,
        prompt: opts.prompt,
        sessionId: opts.sessionId,
        model: opts.model,
        permissionMode: opts.permissionMode,
      },
      spawnCtx,
    )
  } catch (error) {
    if (!isMissingExternalSessionError(error)) throw error
    const externalSessionId = crypto.randomUUID()
    logger.warn(
      {
        issueId,
        oldExternalSessionId: opts.sessionId,
        newExternalSessionId: externalSessionId,
      },
      'missing_external_session_recreate',
    )
    emitDiagnosticLog(
      issueId,
      '',
      '[BKD] External session not found — recreating with fresh session',
      { event: 'session_recreate' },
    )
    // When recreating a session, prepend the project system prompt
    const freshPrompt = opts.systemPrompt ? `${opts.systemPrompt}\n\n${opts.prompt}` : opts.prompt
    const spawned = await executor.spawn(
      {
        workingDir: opts.workingDir,
        prompt: freshPrompt,
        model: opts.model,
        permissionMode: opts.permissionMode,
        externalSessionId,
      },
      spawnCtx,
    )
    const finalSessionId = spawned.externalSessionId ?? externalSessionId
    await saveExternalSessionId(issueId, spawned, finalSessionId)
    if (!spawned.externalSessionId) {
      spawned.externalSessionId = finalSessionId
    }
    return spawned
  }
}

/** Spawn a fresh process (no existing session). */
export async function spawnFresh(
  executor: ReturnType<typeof engineRegistry.get> & object,
  issueId: string,
  opts: {
    workingDir: string
    prompt: string
    model?: string
    permissionMode: PermissionPolicy
    projectId: string
    envVars?: Record<string, string>
    extraArgs?: string[]
  },
): Promise<SpawnedProcess> {
  const externalSessionId = crypto.randomUUID()
  const spawned = await executor.spawn(
    {
      workingDir: opts.workingDir,
      prompt: opts.prompt,
      model: opts.model,
      permissionMode: opts.permissionMode,
      externalSessionId,
    },
    {
      vars: opts.envVars ?? {},
      workingDir: opts.workingDir,
      projectId: opts.projectId,
      issueId,
      extraArgs: opts.extraArgs,
    },
  )
  const finalSessionId = spawned.externalSessionId ?? externalSessionId
  await saveExternalSessionId(issueId, spawned, finalSessionId)
  // Ensure the returned object always carries the session ID so callers
  // (e.g. managed.externalSessionId) don't end up with undefined.
  if (!spawned.externalSessionId) {
    spawned.externalSessionId = finalSessionId
  }
  return spawned
}

export async function spawnRetry(
  ctx: EngineContext,
  issueId: string,
  engineType: EngineType,
): Promise<void> {
  logger.debug({ issueId, engineType }, 'issue_retry_requested')
  const issue = await getIssueWithSession(issueId)
  if (!issue) throw new Error(`Issue not found: ${issueId}`)

  ensureNoActiveProcess(ctx, issueId)

  const executor = engineRegistry.get(engineType)
  if (!executor) throw new Error(`No executor for engine type: ${engineType}`)

  const baseDir = await resolveWorkingDir(issue.projectId)

  const executionId = crypto.randomUUID()

  // Resolve (and admit) the worktree if the issue uses one
  let workingDir = baseDir
  let worktreePath: string | undefined
  let launch: { args: string[], env: Record<string, string> } | undefined
  if (issue.useWorktree) {
    const admitted = await ensureAdmittedWorktree(baseDir, issue.projectId, issueId, engineType, executionId)
    worktreePath = admitted.worktreePath
    workingDir = worktreePath
    launch = admitted.launch
  }

  const permOptions = getPermissionOptions(
    engineType,
    issue.sessionFields.permissionMode ?? undefined,
  )
  const projCtx = await getProjectExecContext(issue.projectId)
  const envVars = await resolveExecEnvVars(issue.engineProfileId, projCtx.envVars)

  const spawnOpts = {
    workingDir,
    prompt: issue.sessionFields.prompt ?? '',
    model: await resolveExecutionModel(engineType, issue.sessionFields.model, issue.engineProfileId),
    permissionMode: permOptions.permissionMode,
    projectId: issue.projectId,
    envVars: launch ? { ...envVars, ...launch.env } : envVars,
    extraArgs: launch?.args,
    systemPrompt: projCtx.systemPrompt,
  }
  ctx.pm.assertCapacity()
  const spawned = issue.sessionFields.externalSessionId ?
      await spawnWithSessionFallback(executor, issueId, {
        ...spawnOpts,
        sessionId: issue.sessionFields.externalSessionId,
      }) :
      await spawnFresh(executor, issueId, spawnOpts)

  const normalizer = createLogNormalizer(executor)

  const turnIndex = getNextTurnIndex(issueId)
  try {
    register(
      ctx,
      executionId,
      issueId,
      engineType,
      spawned,
      line => normalizer.parse(line),
      turnIndex,
      worktreePath,
      makeStreamHooks(ctx, issueId, executionId),
      worktreePath ? baseDir : undefined,
      workingDir,
      spawned.externalSessionId ?? issue.sessionFields.externalSessionId ?? undefined,
      issue.keepAlive,
    )
  } catch (error) {
    killUnregistered(issueId, executionId, spawned)
    throw error
  }
  monitorCompletion(ctx, executionId, issueId, engineType, true)
  logger.debug({ issueId, executionId, engineType, turnIndex }, 'issue_retry_spawned')
}

export async function spawnFollowUpProcess(
  ctx: EngineContext,
  issueId: string,
  prompt: string,
  model?: string,
  permissionMode?: PermissionPolicy,
  displayPrompt?: string,
  metadata?: Record<string, unknown>,
  opts?: { skipPersistMessage?: boolean },
): Promise<{ executionId: string, messageId?: string | null }> {
  logger.debug(
    { issueId, model, permissionMode, promptChars: prompt.length },
    'issue_followup_spawn_process_requested',
  )
  const issue = await getIssueWithSession(issueId)
  if (!issue) throw new Error(`Issue not found: ${issueId}`)
  if (!issue.sessionFields.engineType) throw new Error('No engine type set on issue')

  // Safety guard: kill any existing subprocess for this issue to prevent
  // duplicate CLI processes talking to the same Claude session.
  await killExistingSubprocessForIssue(ctx, issueId)

  const engineType = issue.sessionFields.engineType
  const executor = engineRegistry.get(engineType)
  if (!executor) throw new Error(`No executor for engine type: ${engineType}`)

  if (model && model !== issue.sessionFields.model) {
    await updateIssueSession(issueId, { model })
  }

  const executionId = crypto.randomUUID()
  // 'auto' or a model missing from the engine's list resolves to the
  // engine's default model.
  const effectiveModel = await resolveExecutionModel(
    engineType,
    model ?? issue.sessionFields.model,
    issue.engineProfileId,
  )

  await updateIssueSession(issueId, { sessionStatus: 'running' })

  // Emit SSE 'running' and persist user message BEFORE the potentially slow
  // process spawn (1-10s for CLI download + startup).  This lets the frontend
  // show the thinking indicator immediately instead of waiting for spawn.
  const turnIndex = getNextTurnIndex(issueId)
  ctx.entryCounters.set(executionId, 0)
  ctx.turnIndexes.set(executionId, turnIndex)
  emitStateChange(issueId, executionId, 'running')
  // When flushing pending messages, the user message is already persisted in the
  // DB. Skip creating a duplicate entry.
  const messageId = opts?.skipPersistMessage ?
    null :
      persistUserMessage(ctx, issueId, executionId, prompt, displayPrompt, metadata)

  const baseDir = await resolveWorkingDir(issue.projectId)

  let workingDir = baseDir
  let worktreePath: string | undefined

  const permOptions = getPermissionOptions(
    engineType,
    permissionMode ?? issue.sessionFields.permissionMode ?? undefined,
  )
  const projCtx = await getProjectExecContext(issue.projectId)
  const envVars = await resolveExecEnvVars(issue.engineProfileId, projCtx.envVars)

  const normalizer = createLogNormalizer(executor)
  let spawned: SpawnedProcess | undefined
  try {
    let launchVars = envVars
    let extraArgs: string[] | undefined
    if (issue.useWorktree) {
      const admitted = await ensureAdmittedWorktree(baseDir, issue.projectId, issueId, engineType, executionId)
      worktreePath = admitted.worktreePath
      workingDir = worktreePath
      launchVars = { ...launchVars, ...admitted.launch.env }
      extraArgs = admitted.launch.args
    }
    ctx.pm.assertCapacity()
    const baseSpawnOpts = {
      workingDir,
      prompt,
      model: effectiveModel,
      permissionMode: permOptions.permissionMode,
      projectId: issue.projectId,
      envVars: launchVars,
      extraArgs,
      systemPrompt: projCtx.systemPrompt,
    }
    spawned = issue.sessionFields.externalSessionId
      ? await spawnWithSessionFallback(executor, issueId, {
          ...baseSpawnOpts,
          sessionId: issue.sessionFields.externalSessionId,
        })
      : await spawnFresh(executor, issueId, baseSpawnOpts)
    register(
      ctx,
      executionId,
      issueId,
      engineType,
      spawned,
      line => normalizer.parse(line),
      turnIndex,
      worktreePath,
      makeStreamHooks(ctx, issueId, executionId),
      worktreePath ? baseDir : undefined,
      workingDir,
      spawned.externalSessionId ?? issue.sessionFields.externalSessionId ?? undefined,
      issue.keepAlive,
    )
  } catch (spawnError) {
    // Spawn or registration failed after we already emitted 'running' and
    // persisted the user message.  Revert the session status so the issue
    // doesn't get stuck in 'running' forever with no process to settle it.
    if (spawned) killUnregistered(issueId, executionId, spawned)
    logger.error({ issueId, executionId, err: spawnError }, 'spawn_failed_reverting_session')
    const errorMsg = spawnError instanceof Error ? spawnError.message : String(spawnError)
    emitDiagnosticLog(
      issueId,
      executionId,
      `[BKD] Follow-up spawn failed: ${errorMsg}`,
      { event: 'followup_spawn_failed' },
    )
    emitErrorLog(issueId, executionId, errorMsg)
    // Remove the user message persisted before spawn so it doesn't remain as
    // a ghost entry visible to the frontend.
    if (messageId) {
      try {
        removeLogEntry(messageId)
      } catch (e) {
        logger.error({ issueId, messageId, err: e }, 'spawn_failed_remove_user_message_error')
      }
    }
    await updateIssueSession(issueId, { sessionStatus: 'failed' }).catch(e =>
      logger.error({ issueId, err: e }, 'spawn_failed_revert_session_error'),
    )
    emitStateChange(issueId, executionId, 'failed')
    ctx.entryCounters.delete(executionId)
    ctx.turnIndexes.delete(executionId)
    throw spawnError
  }

  // User message already persisted above (before spawn)
  monitorCompletion(ctx, executionId, issueId, engineType, false)
  const followUpPid = getPidFromSubprocess(spawned.subprocess)
  logger.info(
    {
      issueId,
      executionId,
      pid: followUpPid,
      engineType,
      turnIndex,
      model: effectiveModel,
    },
    'issue_followup_spawned',
  )
  emitDiagnosticLog(
    issueId,
    executionId,
    `[BKD] Follow-up spawned (engine=${engineType}, pid=${followUpPid}, turn=${turnIndex}, model=${effectiveModel ?? 'default'})`,
    { event: 'followup_spawned', pid: followUpPid, engineType, turnIndex },
  )

  return { executionId, messageId }
}
