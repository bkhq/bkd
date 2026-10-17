import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { projects as projectsTable } from '@/db/schema'
import { getIssueWithSession } from '@/engines/engine-store'
import { ClaudeCodeExecutor } from '@/engines/executors/claude/executor'
import { CodexExecutor } from '@/engines/executors/codex/executor'
import { engineRegistry } from '@/engines/executors'
import { issueEngine } from '@/engines/issue/engine'
import {
  ensureWorktree,
  parseWorktreePath,
  removeWorktree,
  resolveWorktreePath,
  WORKTREE_BASE,
} from '@/engines/issue/utils/worktree'
import { getAdmissionCommand, prepareWorktreeAdmission } from '@/engines/issue/utils/worktree-admission'
import * as spawnModule from '@/engines/spawn'
import type { EngineExecutor, ExecutionEnv, FollowUpOptions, SpawnedProcess, SpawnOptions } from '@/engines/types'
import { parseRuntimeConfig, runtimeConfig } from '@/runtime-config'
import { createTestProject, expectSuccess, post, waitFor } from './helpers'
import { MockCodexExecutor } from './mock-codex-executor'
/**
 * Opt-in pre-spawn admission (WORKTREE_ADMISSION_COMMAND): a worktree issue's
 * client starts only after the admission command admits the launch, carries
 * the returned launch args/env, and the lease is cleaned up when the worktree
 * is removed. Unset, nothing changes.
 */
import './setup'

const FAKE = resolve(import.meta.dir, 'fixtures/fake-worktree-admission.ts')
const FAKE_CODEX = resolve(import.meta.dir, 'fixtures/fake-codex-app-server.ts')
const config = runtimeConfig as { WORKTREE_ADMISSION_COMMAND?: string }

/** Executor that records each spawn's directory and execution env. */
class RecordingExecutor extends MockCodexExecutor {
  calls: Array<{ dir: string, env: ExecutionEnv }> = []

  override async spawn(options: SpawnOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    this.calls.push({ dir: options.workingDir, env })
    return super.spawn(options, env as never)
  }

  override async spawnFollowUp(options: FollowUpOptions, env: ExecutionEnv): Promise<SpawnedProcess> {
    this.calls.push({ dir: options.workingDir, env })
    return super.spawnFollowUp(options, env as never)
  }
}

const executor = new RecordingExecutor()
let original: EngineExecutor
let tempDir = ''
let gitRoot = ''
let projectId = ''

function configureFake(mode: 'ready' | 'refuse' | 'garbage'): string {
  const log = join(tempDir, `admission-${crypto.randomUUID()}.log`)
  config.WORKTREE_ADMISSION_COMMAND = `${process.execPath} ${FAKE} ${log} ${mode}`
  return log
}

function calls(log: string): string[][] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf-8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

async function createWorktreeIssue(engineType: 'codex' | 'claude-code' = 'codex'): Promise<string> {
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'Admission issue',
      statusId: 'todo',
      engineType,
      useWorktree: true,
    }),
  )
  return issue.id
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'bkd-admission-'))
  gitRoot = mkdtempSync(join(tmpdir(), 'bkd-admission-repo-'))
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'BKD Test'],
  ]) {
    spawnModule.spawnNodeSync(['git', ...args], { cwd: gitRoot })
  }
  writeFileSync(join(gitRoot, 'README.md'), 'test repo\n')
  spawnModule.spawnNodeSync(['git', 'add', '.'], { cwd: gitRoot })
  spawnModule.spawnNodeSync(['git', 'commit', '-m', 'init'], { cwd: gitRoot })

  projectId = await createTestProject('Worktree admission')
  await db.update(projectsTable).set({ directory: gitRoot }).where(eq(projectsTable.id, projectId))

  original = engineRegistry.get('codex')!
  ;(engineRegistry as any).register(executor)
})

afterEach(() => {
  config.WORKTREE_ADMISSION_COMMAND = undefined
  executor.calls = []
})

afterAll(() => {
  ;(engineRegistry as any).register(original)
  for (const dir of [join(WORKTREE_BASE, projectId), gitRoot, tempDir]) {
    try {
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

describe('admission configuration', () => {
  test('is disabled unless a command is configured', () => {
    expect(parseRuntimeConfig({}).WORKTREE_ADMISSION_COMMAND).toBeUndefined()
    expect(parseRuntimeConfig({ WORKTREE_ADMISSION_COMMAND: '   ' }).WORKTREE_ADMISSION_COMMAND).toBeUndefined()
    expect(getAdmissionCommand()).toBeNull()
    config.WORKTREE_ADMISSION_COMMAND = 'mcp-manager  worktree'
    expect(getAdmissionCommand()).toEqual(['mcp-manager', 'worktree'])
  })

  test('parseWorktreePath inverts resolveWorktreePath', () => {
    expect(parseWorktreePath(resolveWorktreePath('proj1', 'iss1'))).toEqual({ projectId: 'proj1', issueId: 'iss1' })
    expect(parseWorktreePath(join(WORKTREE_BASE, 'proj1'))).toBeNull()
    expect(parseWorktreePath('/tmp/elsewhere/a/b')).toBeNull()
  })
})

describe('prepareWorktreeAdmission', () => {
  const input = { projectId: 'p1', issueId: 'i1', worktreeDir: '/wt/p1/i1', attemptId: 'a1' }

  test('disabled: returns an empty launch without running anything', async () => {
    expect(await prepareWorktreeAdmission({ ...input, engineType: 'codex' })).toEqual({ args: [], env: {} })
  })

  test('passes the manager contract and returns launch args/env', async () => {
    const log = configureFake('ready')
    const launch = await prepareWorktreeAdmission({ ...input, engineType: 'claude-code' })
    expect(launch).toEqual({ args: ['--mcp-config', '/managed/target.json'], env: { MCP_MANAGER_LEASE: 'lease-1' } })
    expect(calls(log)).toEqual([
      ['prepare', '--project', 'p1', '--task', 'i1', '--cwd', '/wt/p1/i1', '--client', 'claude', '--attempt', 'a1'],
    ])
  })

  test('maps codex and skips engines the manager cannot admit', async () => {
    const log = configureFake('ready')
    await prepareWorktreeAdmission({ ...input, engineType: 'codex' })
    expect(await prepareWorktreeAdmission({ ...input, engineType: 'cursor' })).toEqual({ args: [], env: {} })
    const recorded = calls(log)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]![recorded[0]!.indexOf('--client') + 1]).toBe('codex')
  })

  test('a refusal throws with the stable reason', async () => {
    configureFake('refuse')
    await expect(prepareWorktreeAdmission({ ...input, engineType: 'codex' })).rejects.toThrow(
      /Worktree admission refused: exit 1: .*worktree_bkd_mismatch/,
    )
  })

  test('an unreadable reply throws', async () => {
    configureFake('garbage')
    await expect(prepareWorktreeAdmission({ ...input, engineType: 'codex' })).rejects.toThrow(
      'unreadable readiness reply',
    )
  })
})

describe('worktree issue spawn', () => {
  async function waitForIdle(issueId: string): Promise<void> {
    await waitFor(async () => !issueEngine.hasActiveProcessForIssue(issueId), 5000, 50)
  }

  test('disabled: spawn carries no admission args', async () => {
    const issueId = await createWorktreeIssue()
    await issueEngine.executeIssue(issueId, { engineType: 'codex', prompt: 'hi', workingDir: gitRoot })
    await waitForIdle(issueId)
    expect(executor.calls).toHaveLength(1)
    expect(executor.calls[0]!.env.extraArgs ?? []).toEqual([])
    expect(executor.calls[0]!.env.vars.MCP_MANAGER_LEASE).toBeUndefined()
  })

  test('admitted: execute and follow-up carry launch args/env into the worktree', async () => {
    const log = configureFake('ready')
    const issueId = await createWorktreeIssue()
    const worktree = resolveWorktreePath(projectId, issueId)

    await issueEngine.executeIssue(issueId, {
      engineType: 'codex',
      prompt: 'hi',
      workingDir: gitRoot,
      envVars: { PROJECT_VAR: '1' },
    })
    await waitForIdle(issueId)
    await issueEngine.followUpIssue(issueId, 'again')
    await waitForIdle(issueId)

    expect(executor.calls.map(c => c.dir)).toEqual([worktree, worktree])
    for (const call of executor.calls) {
      expect(call.env.extraArgs).toEqual(['--mcp-config', '/managed/target.json'])
      expect(call.env.vars.MCP_MANAGER_LEASE).toBe('lease-1')
    }
    expect(executor.calls[0]!.env.vars.PROJECT_VAR).toBe('1')

    const recorded = calls(log)
    expect(recorded).toHaveLength(2)
    for (const argv of recorded) {
      expect(argv.slice(0, 9)).toEqual([
        'prepare',
        '--project',
        projectId,
        '--task',
        issueId,
        '--cwd',
        worktree,
        '--client',
        'codex',
      ])
    }
    // Each spawn is its own attempt
    expect(recorded[0]![10]).not.toBe(recorded[1]![10])
  })

  test('refused: execute fails without spawning', async () => {
    configureFake('refuse')
    const issueId = await createWorktreeIssue()
    await expect(
      issueEngine.executeIssue(issueId, { engineType: 'codex', prompt: 'hi', workingDir: gitRoot }),
    ).rejects.toThrow('worktree_bkd_mismatch')
    expect(executor.calls).toEqual([])
    expect((await getIssueWithSession(issueId))?.sessionFields.sessionStatus).toBe('failed')
  })
})

describe('worktree removal', () => {
  test('runs admission cleanup for a managed worktree', async () => {
    const log = configureFake('ready')
    const worktree = await ensureWorktree(gitRoot, projectId, 'cleanup-1')
    await removeWorktree(gitRoot, worktree)
    expect(existsSync(worktree)).toBe(false)
    expect(calls(log)).toEqual([
      ['cleanup', '--project', projectId, '--task', 'cleanup-1', '--cwd', worktree, '--reason', 'worktree_removed'],
    ])
  })

  test('removal proceeds when cleanup fails', async () => {
    const worktree = await ensureWorktree(gitRoot, projectId, 'cleanup-2')
    const log = configureFake('refuse')
    await removeWorktree(gitRoot, worktree)
    expect(existsSync(worktree)).toBe(false)
    expect(calls(log)).toHaveLength(1)
  })
})

describe('executor command lines', () => {
  const realSpawnNode = spawnModule.spawnNode

  test('claude appends admission args to the CLI command', async () => {
    let captured: string[] = []
    const spy = spyOn(spawnModule, 'spawnNode').mockImplementation((cmd, options) => {
      captured = cmd
      return realSpawnNode([process.execPath, '-e', 'process.stdin.resume()'], options)
    })
    let spawned: SpawnedProcess | undefined
    try {
      spawned = await new ClaudeCodeExecutor().spawn(
        { workingDir: tempDir, prompt: 'hi', permissionMode: 'auto', externalSessionId: 's1' },
        { vars: {}, workingDir: tempDir, extraArgs: ['--mcp-config', '/managed/target.json'] },
      )
    } finally {
      spy.mockRestore()
      spawned?.subprocess.kill(9)
    }
    const at = captured.indexOf('--mcp-config')
    expect(at).toBeGreaterThan(0)
    expect(captured[at + 1]).toBe('/managed/target.json')
  })

  test('codex places admission overrides before the app-server subcommand', async () => {
    const pidFile = join(tempDir, 'codex-pid')
    let captured: string[] = []
    const spy = spyOn(spawnModule, 'spawnNode').mockImplementation((cmd, options) => {
      captured = cmd
      return realSpawnNode([process.execPath, FAKE_CODEX, pidFile], options)
    })
    try {
      // The fake rejects thread/resume; only the command line matters here.
      await new CodexExecutor().spawnFollowUp(
        { workingDir: tempDir, prompt: 'hi', sessionId: 't1', permissionMode: 'auto' },
        { vars: {}, workingDir: tempDir, extraArgs: ['-c', 'mcp_servers.m.command="bridge"'] },
      ).catch(() => {})
    } finally {
      spy.mockRestore()
    }
    expect(captured.slice(-3)).toEqual(['-c', 'mcp_servers.m.command="bridge"', 'app-server'])
  })
})
