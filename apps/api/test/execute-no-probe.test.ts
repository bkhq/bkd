import type { EngineAvailability } from '@bkd/shared'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { engineRegistry } from '@/engines/executors'
import { createTestIssue, createTestProject, expectSuccess, get, waitFor } from './helpers'
/**
 * Executing an issue must not probe the engine.
 *
 * The Claude executor's getAvailability() shells out to `claude --version` and
 * `claude auth status --json`, and the latter touches the rotating OAuth
 * credential. Running that per execution — concurrently, up to the execution
 * limit — races the refresh and can invalidate the session for every process
 * (ENG-034). Availability belongs to the cached engine probe, nowhere else.
 */
import './setup'

interface Issue {
  id: string
  sessionStatus: string | null
  [key: string]: unknown
}

let projectId: string
let probeCount = 0
let restore: (() => void) | undefined

beforeAll(async () => {
  projectId = await createTestProject()

  // Count probes without changing what the executor reports.
  const executor = engineRegistry.get('codex') as unknown as {
    getAvailability: () => Promise<EngineAvailability>
  }
  const original = executor.getAvailability.bind(executor)
  executor.getAvailability = async () => {
    probeCount++
    return original()
  }
  restore = () => {
    executor.getAvailability = original
  }
})

afterAll(() => {
  restore?.()
})

describe('execution path', () => {
  test('does not probe engine availability', async () => {
    // Creating a `working` issue runs it through executeIssue.
    const created = await createTestIssue(projectId, {
      title: 'No probe on execute',
      statusId: 'working',
      engineType: 'codex',
    })
    expect(created.status).toBe(202)
    const issue = expectSuccess(created) as Issue

    // Wait until the engine actually spawned, so the assertion covers a real run.
    await waitFor(async () => {
      const res = await get<Issue>(`/api/projects/${projectId}/issues/${issue.id}`)
      const status = res.json.success ? res.json.data.sessionStatus : null
      return status !== null && status !== 'pending'
    }, 5000)

    expect(probeCount).toBe(0)
  })
})
