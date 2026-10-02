import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { getIssueWithSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import { issueEngine } from '@/engines/issue/engine'
import type { ManagedProcess } from '@/engines/issue/types'
import type { ProcessManager } from '@/engines/process-manager'
import { spawnNode } from '@/engines/spawn'
import type { EngineExecutor, SpawnedProcess } from '@/engines/types'
import { createTestIssue, createTestProject, expectSuccess, waitFor } from './helpers'
import { MockCodexExecutor } from './mock-codex-executor'
/**
 * A failed registration must never leave the spawned engine process running.
 *
 * The engine is spawned before it is registered with the process manager, and
 * an unregistered child has no owner: nothing reads its output and cancel
 * cannot reach it, yet it keeps working on the prompt it was given.
 */
import './setup'

const pm = (issueEngine as unknown as { ctx: { pm: ProcessManager<ManagedProcess> } }).ctx.pm

/** Executor that spawns a real, long-lived child for each turn. */
class SleepExecutor extends MockCodexExecutor {
  pids: number[] = []
  onSpawned?: () => void

  private start(): SpawnedProcess {
    const proc = spawnNode(['sleep', '300'])
    this.pids.push(proc.pid!)
    this.onSpawned?.()
    return {
      subprocess: proc,
      stdout: proc.stdout,
      stderr: proc.stderr,
      cancel: () => proc.kill(),
    }
  }

  override async spawn(): Promise<SpawnedProcess> {
    return this.start()
  }

  override async spawnFollowUp(): Promise<SpawnedProcess> {
    return this.start()
  }
}

const executor = new SleepExecutor()
let original: EngineExecutor
let originalMax: number
let projectId: string
const slots: string[] = []
let slotSeq = 0

/** Take one concurrency slot with an entry that belongs to no issue. */
function occupySlot(): void {
  let release!: (code: number) => void
  const exited = new Promise<number>((r) => {
    release = r
  })
  const handle = { pid: undefined, exited, kill: () => release(137) }
  const id = `test-slot-${++slotSeq}`
  const meta = { logs: { destroy() {} } } as unknown as ManagedProcess
  pm.register(id, handle as never, meta, { startAsRunning: true })
  slots.push(id)
}

/** Use up every free slot. */
function fillCapacity(): void {
  pm.setMaxConcurrent(slots.length + 1)
  occupySlot()
}

function releaseSlots(): void {
  for (const id of slots.splice(0)) pm.forceKill(id)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function expectAllDead(): Promise<void> {
  expect(executor.pids.length).toBeGreaterThan(0)
  await waitFor(async () => executor.pids.every(pid => !isAlive(pid)), 3000, 50)
}

async function createFailedIssue(): Promise<string> {
  const issue = expectSuccess(await createTestIssue(projectId, { engineType: 'codex' })) as {
    id: string
  }
  // Leave the session failed with engine + prompt set, as an execute that hit
  // the limit does, so follow-up and restart have something to resume.
  fillCapacity()
  await expect(
    issueEngine.executeIssue(issue.id, { engineType: 'codex', prompt: 'hello' }),
  ).rejects.toThrow('Concurrency limit reached')
  releaseSlots()
  return issue.id
}

async function sessionStatus(issueId: string): Promise<string | null | undefined> {
  return (await getIssueWithSession(issueId))?.sessionFields.sessionStatus
}

beforeAll(async () => {
  projectId = await createTestProject('Spawn leak')
  original = engineRegistry.get('codex')!
  ;(engineRegistry as any).register(executor)
  originalMax = pm.getMaxConcurrent()
})

// The process manager is shared with other test files; wait for their
// processes to finish so the slot count is ours alone.
beforeEach(async () => {
  await waitFor(async () => pm.activeCount() === 0, 10_000, 50)
})

afterEach(async () => {
  executor.onSpawned = undefined
  releaseSlots()
  for (const pid of executor.pids) {
    try {
      process.kill(pid, 9)
    } catch {}
  }
  executor.pids = []
  pm.setMaxConcurrent(originalMax)
})

afterAll(() => {
  ;(engineRegistry as any).register(original)
})

describe('concurrency limit already full', () => {
  test('execute does not spawn', async () => {
    const issue = expectSuccess(await createTestIssue(projectId, { engineType: 'codex' })) as {
      id: string
    }
    fillCapacity()

    await expect(
      issueEngine.executeIssue(issue.id, { engineType: 'codex', prompt: 'hello' }),
    ).rejects.toThrow('Concurrency limit reached')
    expect(executor.pids).toEqual([])
    expect(await sessionStatus(issue.id)).toBe('failed')
  })

  test('follow-up does not spawn', async () => {
    const issueId = await createFailedIssue()
    fillCapacity()

    await expect(issueEngine.followUpIssue(issueId, 'again')).rejects.toThrow(
      'Concurrency limit reached',
    )
    expect(executor.pids).toEqual([])
    expect(await sessionStatus(issueId)).toBe('failed')
  })

  test('restart does not spawn', async () => {
    const issueId = await createFailedIssue()
    fillCapacity()

    await expect(issueEngine.restartIssue(issueId)).rejects.toThrow('Concurrency limit reached')
    expect(executor.pids).toEqual([])
    expect(await sessionStatus(issueId)).toBe('failed')
  })
})

describe('concurrency limit filled while spawning', () => {
  test('execute kills the child when registration fails', async () => {
    const issue = expectSuccess(await createTestIssue(projectId, { engineType: 'codex' })) as {
      id: string
    }
    executor.onSpawned = fillCapacity

    await expect(
      issueEngine.executeIssue(issue.id, { engineType: 'codex', prompt: 'hello' }),
    ).rejects.toThrow('Concurrency limit reached')
    await expectAllDead()
    expect(await sessionStatus(issue.id)).toBe('failed')
  })

  test('follow-up kills the child when registration fails', async () => {
    const issueId = await createFailedIssue()
    executor.onSpawned = fillCapacity

    await expect(issueEngine.followUpIssue(issueId, 'again')).rejects.toThrow(
      'Concurrency limit reached',
    )
    await expectAllDead()
    expect(await sessionStatus(issueId)).toBe('failed')
  })

  test('restart kills the child when registration fails', async () => {
    const issueId = await createFailedIssue()
    executor.onSpawned = fillCapacity

    await expect(issueEngine.restartIssue(issueId)).rejects.toThrow('Concurrency limit reached')
    await expectAllDead()
    expect(await sessionStatus(issueId)).toBe('failed')
  })
})
