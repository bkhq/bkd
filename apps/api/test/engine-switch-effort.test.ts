import type { VirtualEngine } from '@bkd/shared'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import { ClaudeCodeExecutor } from '@/engines/executors/claude/executor'
import { issueEngine } from '@/engines/issue/engine'
import type { EngineExecutor, ExecutionEnv, FollowUpOptions, SpawnedProcess, SpawnOptions } from '@/engines/types'
import { api, createTestProject, expectError, expectSuccess, get, patch, post, waitFor } from './helpers'
import { MockCodexExecutor } from './mock-codex-executor'
/**
 * An issue can move between engines that share a base engine (a real engine
 * and its virtual engines) and carries a reasoning effort to the CLI.
 */
import './setup'

interface Spawn {
  effort?: string
  vars: Record<string, string>
}

class RecordingExecutor extends MockCodexExecutor {
  spawns: Spawn[] = []

  override async spawn(options: SpawnOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    this.spawns.push({ effort: options.effort, vars: env.vars })
    return super.spawn(options, env)
  }

  override async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    this.spawns.push({ effort: options.effort, vars: env.vars })
    return super.spawnFollowUp(options, env)
  }
}

const VIRTUALS: VirtualEngine[] = [
  { id: 'codex-alt', name: 'Codex alt', baseEngine: 'codex', envVars: { ALT_MARK: 'alt' } },
  { id: 'claude-alt', name: 'Claude alt', baseEngine: 'claude-code', envVars: {} },
]

const executor = new RecordingExecutor()
let original: EngineExecutor
let projectId = ''

interface IssueView {
  id: string
  statusId: string
  sessionStatus: string | null
  engineType: string | null
  engineProfileId: string | null
  effort: string | null
}

const issueUrl = (id: string) => `/api/projects/${projectId}/issues/${id}`

async function getIssue(id: string): Promise<IssueView> {
  return expectSuccess(await get<IssueView>(issueUrl(id)))
}

async function waitForIdle(issueId: string): Promise<void> {
  await waitFor(async () => !issueEngine.hasActiveProcessForIssue(issueId), 5000, 50)
  await waitFor(async () => (await getIssue(issueId)).statusId === 'review', 5000, 50)
}

/** A codex issue that has run one turn and settled in review. */
async function executedIssue(): Promise<string> {
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'Switch issue',
      statusId: 'working',
      engineType: 'codex',
    }),
  )
  await waitForIdle(issue.id)
  executor.spawns = []
  return issue.id
}

beforeAll(async () => {
  projectId = await createTestProject('Engine switch')
  original = engineRegistry.get('codex')!
  ;(engineRegistry as any).register(executor)
  expectSuccess(await api('PUT', '/api/engines/virtual', { engines: VIRTUALS }))
})

afterEach(() => {
  executor.spawns = []
})

afterAll(async () => {
  ;(engineRegistry as any).register(original)
  await api('PUT', '/api/engines/virtual', { engines: [] })
})

describe('follow-up engine switch', () => {
  test('switches to a virtual engine with the same base engine', async () => {
    const id = await executedIssue()

    const res = await post(`${issueUrl(id)}/follow-up`, { prompt: 'next', engineType: 'codex-alt' })
    expect(res.status).toBe(200)
    await waitForIdle(id)

    expect((await getIssue(id)).engineProfileId).toBe('codex-alt')
    expect(executor.spawns).toHaveLength(1)
    expect(executor.spawns[0]!.vars.ALT_MARK).toBe('alt')
  })

  test('switches back to the base engine', async () => {
    const id = await executedIssue()
    await post(`${issueUrl(id)}/follow-up`, { prompt: 'a', engineType: 'codex-alt' })
    await waitForIdle(id)
    executor.spawns = []

    await post(`${issueUrl(id)}/follow-up`, { prompt: 'b', engineType: 'codex' })
    await waitForIdle(id)

    expect((await getIssue(id)).engineProfileId).toBeNull()
    expect(executor.spawns[0]!.vars.ALT_MARK).toBeUndefined()
  })

  test('rejects an engine with another base engine', async () => {
    const id = await executedIssue()

    expectError(await post(`${issueUrl(id)}/follow-up`, { prompt: 'x', engineType: 'claude-alt' }), 400)
    expectError(await post(`${issueUrl(id)}/follow-up`, { prompt: 'x', engineType: 'claude-code' }), 400)
    expectError(await post(`${issueUrl(id)}/follow-up`, { prompt: 'x', engineType: 'nope' }), 400)
    expect((await getIssue(id)).engineProfileId).toBeNull()
    expect(executor.spawns).toHaveLength(0)
  })

  test('rejects a switch while the session is running', async () => {
    const id = await executedIssue()
    await updateIssueSession(id, { sessionStatus: 'running' })

    expectError(await post(`${issueUrl(id)}/follow-up`, { prompt: 'x', engineType: 'codex-alt' }), 409)
    expectError(await post(`${issueUrl(id)}/follow-up`, { prompt: 'x', effort: 'high' }), 409)
    await updateIssueSession(id, { sessionStatus: 'completed' })
  })
})

describe('effort', () => {
  test('a follow-up effort is stored and reaches the spawn and later turns', async () => {
    const id = await executedIssue()

    await post(`${issueUrl(id)}/follow-up`, { prompt: 'a', effort: 'high' })
    await waitForIdle(id)
    expect((await getIssue(id)).effort).toBe('high')

    await post(`${issueUrl(id)}/follow-up`, { prompt: 'b' })
    await waitForIdle(id)

    expect(executor.spawns.map(s => s.effort)).toEqual(['high', 'high'])
  })

  test('effort auto clears the stored effort', async () => {
    const id = await executedIssue()
    await post(`${issueUrl(id)}/follow-up`, { prompt: 'a', effort: 'max' })
    await waitForIdle(id)
    executor.spawns = []

    await post(`${issueUrl(id)}/follow-up`, { prompt: 'b', effort: 'auto' })
    await waitForIdle(id)

    expect((await getIssue(id)).effort).toBeNull()
    expect(executor.spawns[0]!.effort).toBeUndefined()
  })

  test('rejects an unknown effort', async () => {
    const id = await executedIssue()
    expectError(await post(`${issueUrl(id)}/follow-up`, { prompt: 'a', effort: 'huge' }), 400)
  })

  test('execute stores the effort', async () => {
    const id = await executedIssue()
    await issueEngine.executeIssue(id, { engineType: 'codex', prompt: 'again', effort: 'low' })
    await waitFor(async () => !issueEngine.hasActiveProcessForIssue(id), 5000, 50)

    expect((await getIssue(id)).effort).toBe('low')
    expect(executor.spawns[0]!.effort).toBe('low')
  })
})

describe('PATCH engine and effort', () => {
  test('outside working, engine and effort apply right away', async () => {
    const id = await executedIssue()

    const updated = expectSuccess(
      await patch<IssueView>(issueUrl(id), { engineType: 'codex-alt', effort: 'xhigh' }),
    )
    expect(updated.engineProfileId).toBe('codex-alt')
    expect(updated.effort).toBe('xhigh')

    const cleared = expectSuccess(await patch<IssueView>(issueUrl(id), { engineType: 'codex', effort: null }))
    expect(cleared.engineProfileId).toBeNull()
    expect(cleared.effort).toBeNull()
  })

  test('rejects another base engine', async () => {
    const id = await executedIssue()
    expectError(await patch(issueUrl(id), { engineType: 'claude-alt' }), 400)
  })

  test('rejects engine and effort changes while working', async () => {
    const id = await executedIssue()
    await patch(issueUrl(id), { statusId: 'working' })
    await waitFor(async () => (await getIssue(id)).statusId === 'working', 5000, 50)

    expectError(await patch(issueUrl(id), { engineType: 'codex-alt' }), 409)
    expectError(await patch(issueUrl(id), { effort: 'low' }), 409)
  })
})

/** A process that stays alive between turns, like a conversational engine. */
function liveProcess(sent: string[]): SpawnedProcess {
  const encoder = new TextEncoder()
  let out!: ReadableStreamDefaultController<Uint8Array>
  let resolveExit!: (code: number) => void
  const exited = new Promise<number>((r) => {
    resolveExit = r
  })
  const result = (text: string) => setTimeout(() => {
    out.enqueue(encoder.encode(`${JSON.stringify({ type: 'result', result: text, session_id: 's' })}\n`))
  }, 20)
  const stop = () => {
    try {
      out.close()
    } catch {}
    resolveExit(0)
  }
  return {
    subprocess: { pid: 0, kill: stop, exited } as unknown as SpawnedProcess['subprocess'],
    stdout: new ReadableStream({
      start(c) {
        out = c
        result('first')
      },
    }),
    stderr: new ReadableStream({ start: c => c.close() }),
    cancel: stop,
    protocolHandler: {
      interrupt: () => {},
      close: stop,
      sendUserMessage: (content: string) => {
        sent.push(content)
        result(content)
      },
    },
  }
}

class LiveExecutor extends MockCodexExecutor {
  spawnCount = 0
  sent: string[] = []

  override async spawn(): Promise<SpawnedProcess> {
    this.spawnCount++
    return liveProcess(this.sent)
  }

  override async spawnFollowUp(): Promise<SpawnedProcess> {
    this.spawnCount++
    return liveProcess(this.sent)
  }
}

describe('live process reuse', () => {
  test('a changed effort replaces an idle live process; unchanged settings reuse it', async () => {
    const live = new LiveExecutor()
    ;(engineRegistry as any).register(live)
    try {
      const issue = expectSuccess(
        await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
          title: 'Live issue',
          statusId: 'working',
          engineType: 'codex',
          keepAlive: true,
        }),
      )
      await waitFor(async () => (await getIssue(issue.id)).statusId === 'review', 5000, 50)
      expect(issueEngine.hasActiveProcessForIssue(issue.id)).toBe(true)

      const settled = async () => (await getIssue(issue.id)).sessionStatus === 'completed'

      await post(`${issueUrl(issue.id)}/follow-up`, { prompt: 'same' })
      await waitFor(async () => live.sent.length === 1 && await settled(), 5000, 50)
      expect(live.sent).toEqual(['same'])
      expect(live.spawnCount).toBe(1)

      await post(`${issueUrl(issue.id)}/follow-up`, { prompt: 'harder', effort: 'max' })
      await waitFor(async () => live.spawnCount === 2 && await settled(), 5000, 50)
      expect(live.sent).toEqual(['same'])
      await issueEngine.cancelIssue(issue.id)
    } finally {
      ;(engineRegistry as any).register(executor)
    }
  }, 15_000)
})

describe('claude executor effort', () => {
  test('sets CLAUDE_CODE_EFFORT_LEVEL over a profile value', async () => {
    const claude = new ClaudeCodeExecutor()
    const env: ExecutionEnv = { vars: { CLAUDE_CODE_EFFORT_LEVEL: 'low' }, workingDir: '/tmp' }

    const withEffort = await (claude as any).createBaseBuilder({ workingDir: '/tmp', prompt: 'x', effort: 'max' }, env)
    expect(withEffort.build().env.CLAUDE_CODE_EFFORT_LEVEL).toBe('max')

    const without = await (claude as any).createBaseBuilder({ workingDir: '/tmp', prompt: 'x' }, env)
    expect(without.build().env.CLAUDE_CODE_EFFORT_LEVEL).toBe('low')
  })
})
