import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { projects as projectsTable } from '@/db/schema'
import { getIssueWithSession, updateIssueSession } from '@/engines/engine-store'
import { engineRegistry } from '@/engines/executors'
import { issueEngine } from '@/engines/issue/engine'
import { ensureWorktree, resolveWorktreePath, WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { spawnNodeSync } from '@/engines/spawn'
import type { EngineExecutor, FollowUpOptions, SpawnedProcess, SpawnOptions } from '@/engines/types'
import { createTestProject, expectSuccess, post, waitFor } from './helpers'
import { MockCodexExecutor } from './mock-codex-executor'
/**
 * An issue with `useWorktree` must run inside its worktree on every turn, and
 * must not run at all when the worktree cannot be provided. Falling back to
 * the project directory lets an isolated issue edit the main checkout.
 */
import './setup'

/** Executor that records the directory each turn was spawned in. */
class RecordingExecutor extends MockCodexExecutor {
  dirs: string[] = []

  override async spawn(options: SpawnOptions, env: never): Promise<SpawnedProcess> {
    this.dirs.push(options.workingDir)
    return super.spawn(options, env)
  }

  override async spawnFollowUp(options: FollowUpOptions, env: never): Promise<SpawnedProcess> {
    this.dirs.push(options.workingDir)
    return super.spawnFollowUp(options, env)
  }
}

const executor = new RecordingExecutor()
let original: EngineExecutor
let gitRoot = ''
let plainDir = ''
let gitProjectId = ''
let plainProjectId = ''

function gitSync(args: string[], cwd: string): void {
  spawnNodeSync(['git', ...args], { cwd })
}

async function createProject(name: string, directory: string): Promise<string> {
  const id = await createTestProject(name)
  await db.update(projectsTable).set({ directory }).where(eq(projectsTable.id, id))
  return id
}

async function createWorktreeIssue(projectId: string): Promise<string> {
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'Worktree issue',
      statusId: 'todo',
      engineType: 'codex',
      useWorktree: true,
    }),
  )
  return issue.id
}

async function sessionStatus(issueId: string): Promise<string | null | undefined> {
  return (await getIssueWithSession(issueId))?.sessionFields.sessionStatus
}

async function waitForIdle(issueId: string): Promise<void> {
  await waitFor(async () => !issueEngine.hasActiveProcessForIssue(issueId), 5000, 50)
}

beforeAll(async () => {
  gitRoot = mkdtempSync(join(tmpdir(), 'bkd-worktree-reuse-repo-'))
  gitSync(['init', '-b', 'main'], gitRoot)
  gitSync(['config', 'user.email', 'test@example.com'], gitRoot)
  gitSync(['config', 'user.name', 'BKD Test'], gitRoot)
  writeFileSync(join(gitRoot, 'README.md'), 'test repo\n')
  gitSync(['add', '.'], gitRoot)
  gitSync(['commit', '-m', 'init'], gitRoot)
  plainDir = mkdtempSync(join(tmpdir(), 'bkd-worktree-reuse-plain-'))

  gitProjectId = await createProject('Worktree reuse', gitRoot)
  plainProjectId = await createProject('Worktree reuse (no git)', plainDir)

  original = engineRegistry.get('codex')!
  ;(engineRegistry as any).register(executor)
})

afterEach(() => {
  executor.dirs = []
})

afterAll(() => {
  ;(engineRegistry as any).register(original)
  for (const dir of [
    join(WORKTREE_BASE, gitProjectId),
    join(WORKTREE_BASE, plainProjectId),
    gitRoot,
    plainDir,
  ]) {
    try {
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

describe('ensureWorktree', () => {
  test('returns the existing worktree on a second call', async () => {
    const first = await ensureWorktree(gitRoot, gitProjectId, 'ensure-twice')
    expect(first).toBe(resolveWorktreePath(gitProjectId, 'ensure-twice'))
    expect(existsSync(join(first, '.git'))).toBe(true)

    expect(await ensureWorktree(gitRoot, gitProjectId, 'ensure-twice')).toBe(first)
  })

  test('throws outside a git repository', async () => {
    await expect(ensureWorktree(plainDir, plainProjectId, 'ensure-plain')).rejects.toThrow(
      'not a git repository',
    )
  })
})

describe('worktree issue turns', () => {
  test('restart runs in the existing worktree', async () => {
    const issueId = await createWorktreeIssue(gitProjectId)
    const worktree = resolveWorktreePath(gitProjectId, issueId)

    await issueEngine.executeIssue(issueId, {
      engineType: 'codex',
      prompt: 'hello',
      workingDir: gitRoot,
    })
    await waitForIdle(issueId)
    await updateIssueSession(issueId, { sessionStatus: 'failed' })

    await issueEngine.restartIssue(issueId)
    await waitForIdle(issueId)

    expect(executor.dirs).toEqual([worktree, worktree])
  })

  test('a second execute runs in the existing worktree', async () => {
    const issueId = await createWorktreeIssue(gitProjectId)
    const worktree = resolveWorktreePath(gitProjectId, issueId)

    for (const prompt of ['first', 'second']) {
      await issueEngine.executeIssue(issueId, {
        engineType: 'codex',
        prompt,
        workingDir: gitRoot,
      })
      await waitForIdle(issueId)
    }

    expect(executor.dirs).toEqual([worktree, worktree])
  })

  test('execute fails without spawning when the worktree cannot be created', async () => {
    const issueId = await createWorktreeIssue(plainProjectId)

    await expect(
      issueEngine.executeIssue(issueId, {
        engineType: 'codex',
        prompt: 'hello',
        workingDir: plainDir,
      }),
    ).rejects.toThrow('not a git repository')
    expect(executor.dirs).toEqual([])
    expect(await sessionStatus(issueId)).toBe('failed')
  })

  test('follow-up fails without spawning when the worktree cannot be created', async () => {
    const issueId = await createWorktreeIssue(plainProjectId)
    await updateIssueSession(issueId, { engineType: 'codex', sessionStatus: 'failed' })

    await expect(issueEngine.followUpIssue(issueId, 'again')).rejects.toThrow(
      'not a git repository',
    )
    expect(executor.dirs).toEqual([])
    expect(await sessionStatus(issueId)).toBe('failed')
  })
})
