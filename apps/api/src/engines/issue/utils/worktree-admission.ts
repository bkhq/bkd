import * as z from 'zod'
import { runCommand } from '@/engines/spawn'
import type { EngineType } from '@/engines/types'
import { logger } from '@/logger'
import { runtimeConfig } from '@/runtime-config'

/**
 * Opt-in pre-spawn admission for worktree issues.
 *
 * When `WORKTREE_ADMISSION_COMMAND` is set (e.g. `mcp-manager worktree`), a
 * worktree issue's client is spawned only after
 * `<command> prepare --project --task --cwd --client --attempt` exits 0. Its
 * JSON reply carries `launch.args` (appended to the client command line) and
 * `launch.env` (merged into the client environment). A non-zero exit, a
 * timeout or an unreadable reply aborts the spawn. When a worktree is removed,
 * `<command> cleanup --project --task --cwd` runs best-effort.
 *
 * Unset or blank, nothing runs and spawn behaviour is unchanged.
 */

export interface WorktreeLaunch {
  args: string[]
  env: Record<string, string>
}

const EMPTY_LAUNCH: WorktreeLaunch = { args: [], env: {} }

/** Admission speaks the manager's client names; other engines are not admitted. */
const ADMISSION_CLIENTS: Partial<Record<EngineType, string>> = {
  'claude-code': 'claude',
  'codex': 'codex',
}

const PreparationReplySchema = z.object({
  ready: z.literal(true),
  leaseId: z.string().optional(),
  delivery: z.string().optional(),
  reused: z.boolean().optional(),
  launch: z.object({
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
  }),
  requirements: z.array(z.object({ reason: z.string() })).optional(),
})

/** Configured admission command split into argv, or null when disabled. */
export function getAdmissionCommand(): string[] | null {
  const raw = runtimeConfig.WORKTREE_ADMISSION_COMMAND
  if (!raw) return null
  const parts = raw.split(/\s+/).filter(Boolean)
  return parts.length > 0 ? parts : null
}

function describeFailure(result: { code: number, stdout: string, stderr: string, timedOut?: boolean }): string {
  if (result.timedOut) return `timed out after ${runtimeConfig.WORKTREE_ADMISSION_TIMEOUT_MS}ms`
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 1000)
  return detail ? `exit ${result.code}: ${detail}` : `exit ${result.code}`
}

/**
 * Ask the admission command to prepare a launch into `worktreeDir`.
 * Returns the launch additions, or an empty launch when admission is disabled
 * or the engine has no admission client. Throws when admission refuses.
 */
export async function prepareWorktreeAdmission(input: {
  projectId: string
  issueId: string
  worktreeDir: string
  engineType: EngineType
  attemptId: string
}): Promise<WorktreeLaunch> {
  const command = getAdmissionCommand()
  if (!command) return EMPTY_LAUNCH

  const client = ADMISSION_CLIENTS[input.engineType]
  if (!client) {
    logger.info(
      { issueId: input.issueId, engineType: input.engineType },
      'worktree_admission_skipped_unsupported_engine',
    )
    return EMPTY_LAUNCH
  }

  let result: Awaited<ReturnType<typeof runCommand>>
  try {
    result = await runCommand(
      [
        ...command,
        'prepare',
        '--project',
        input.projectId,
        '--task',
        input.issueId,
        '--cwd',
        input.worktreeDir,
        '--client',
        client,
        '--attempt',
        input.attemptId,
      ],
      { stderr: 'pipe', timeout: runtimeConfig.WORKTREE_ADMISSION_TIMEOUT_MS },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`Worktree admission failed to run: ${msg}`)
  }

  if (result.code !== 0 || result.timedOut) {
    throw new Error(`Worktree admission refused: ${describeFailure(result)}`)
  }

  let reply: z.infer<typeof PreparationReplySchema>
  try {
    reply = PreparationReplySchema.parse(JSON.parse(result.stdout))
  } catch {
    throw new Error('Worktree admission refused: unreadable readiness reply')
  }

  logger.info(
    {
      issueId: input.issueId,
      attemptId: input.attemptId,
      leaseId: reply.leaseId,
      delivery: reply.delivery,
      reused: reply.reused,
      launchArgs: reply.launch.args.length,
      launchEnvKeys: Object.keys(reply.launch.env),
      requirements: reply.requirements?.map(r => r.reason),
    },
    'worktree_admission_ready',
  )
  return reply.launch
}

/** Best-effort cleanup of an admitted worktree; never throws. */
export async function cleanupWorktreeAdmission(input: {
  projectId: string
  issueId: string
  worktreeDir: string
  reason: string
}): Promise<void> {
  const command = getAdmissionCommand()
  if (!command) return
  const ids = { projectId: input.projectId, issueId: input.issueId }
  try {
    const result = await runCommand(
      [
        ...command,
        'cleanup',
        '--project',
        input.projectId,
        '--task',
        input.issueId,
        '--cwd',
        input.worktreeDir,
        '--reason',
        input.reason,
      ],
      { stderr: 'pipe', timeout: runtimeConfig.WORKTREE_ADMISSION_TIMEOUT_MS },
    )
    if (result.code !== 0 || result.timedOut) {
      logger.warn(
        { worktreeDir: input.worktreeDir, ...ids, detail: describeFailure(result) },
        'worktree_admission_cleanup_failed',
      )
    }
  } catch (error) {
    logger.warn({ worktreeDir: input.worktreeDir, ...ids, error }, 'worktree_admission_cleanup_failed')
  }
}
