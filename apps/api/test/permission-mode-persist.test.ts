import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import { issueEngine } from '@/engines/issue/engine'
import type { EngineExecutor, FollowUpOptions, SpawnedProcess, SpawnOptions } from '@/engines/types'
import { createTestProject, expectSuccess, post, waitFor } from './helpers'
import { MockCodexExecutor } from './mock-codex-executor'
/**
 * The permission mode chosen for an issue must survive turns that carry no
 * request of their own (restart, retry, pending flush, status-triggered
 * execute). Without a stored mode those fall back to the engine default,
 * `auto`, and re-run a `plan` / `supervised` issue with full permissions.
 */
import './setup'

/** Executor that records the permission mode each turn was spawned with. */
class RecordingExecutor extends MockCodexExecutor {
  modes: Array<string | undefined> = []

  override async spawn(options: SpawnOptions, env: never): Promise<SpawnedProcess> {
    this.modes.push(options.permissionMode)
    return super.spawn(options, env)
  }

  override async spawnFollowUp(options: FollowUpOptions, env: never): Promise<SpawnedProcess> {
    this.modes.push(options.permissionMode)
    return super.spawnFollowUp(options, env)
  }
}

const executor = new RecordingExecutor()
let original: EngineExecutor
let projectId = ''

async function createIssue(permissionMode?: string): Promise<string> {
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'Permission issue',
      statusId: 'todo',
      engineType: 'codex',
      ...(permissionMode ? { permissionMode } : {}),
    }),
  )
  return issue.id
}

async function waitForIdle(issueId: string): Promise<void> {
  await waitFor(async () => !issueEngine.hasActiveProcessForIssue(issueId), 5000, 50)
}

async function restart(issueId: string): Promise<void> {
  await updateIssueSession(issueId, { sessionStatus: 'failed' })
  await issueEngine.restartIssue(issueId)
  await waitForIdle(issueId)
}

beforeAll(async () => {
  projectId = await createTestProject('Permission mode')
  original = engineRegistry.get('codex')!
  ;(engineRegistry as any).register(executor)
})

afterEach(() => {
  executor.modes = []
})

afterAll(() => {
  ;(engineRegistry as any).register(original)
})

describe('stored permission mode', () => {
  test('the mode chosen at create is used by execute and restart', async () => {
    const issueId = await createIssue('plan')

    await issueEngine.executeIssue(issueId, { engineType: 'codex', prompt: 'hello' })
    await waitForIdle(issueId)
    await restart(issueId)

    expect(executor.modes).toEqual(['plan', 'plan'])
  })

  test('the mode passed to execute is used by restart', async () => {
    const issueId = await createIssue()

    await issueEngine.executeIssue(issueId, {
      engineType: 'codex',
      prompt: 'hello',
      permissionMode: 'supervised',
    })
    await waitForIdle(issueId)
    await restart(issueId)

    expect(executor.modes).toEqual(['supervised', 'supervised'])
  })

  test('a follow-up replaces the stored mode', async () => {
    const issueId = await createIssue('plan')
    await issueEngine.executeIssue(issueId, { engineType: 'codex', prompt: 'hello' })
    await waitForIdle(issueId)

    await issueEngine.followUpIssue(issueId, 'second', undefined, 'supervised')
    await waitForIdle(issueId)
    await issueEngine.followUpIssue(issueId, 'third')
    await waitForIdle(issueId)
    await restart(issueId)

    expect(executor.modes).toEqual(['plan', 'supervised', 'supervised', 'supervised'])
  })

  test('an issue with no stored mode keeps the engine default', async () => {
    const issueId = await createIssue()

    await issueEngine.executeIssue(issueId, { engineType: 'codex', prompt: 'hello' })
    await waitForIdle(issueId)

    expect(executor.modes).toEqual(['auto'])
  })
})
