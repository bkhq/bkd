import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
// Loads the app first so zod carries the OpenAPI extension the route module needs.
import '@/app'
import { runWorktreeCleanup, WORKTREE_AUTO_CLEANUP_KEY } from '@/cron/actions/builtins/worktree-cleanup'
import { db } from '@/db'
import { getAppSetting, setAppSetting } from '@/db/helpers'
import { issues as issuesTable, projects as projectsTable } from '@/db/schema'
import { issueEngine } from '@/engines/issue'
import {
  createWorktree,
  isWorktreeRegistered,
  WORKTREE_BASE,
} from '@/engines/issue/utils/worktree'
import { spawnNodeSync } from '@/engines/spawn'
import { removeWorktrees } from '@/routes/settings/cleanup'
import { createTestProject, del, expectSuccess, get, post } from './helpers'
/**
 * Worktrees of deleted issues are kept so a recycle-bin restore is lossless,
 * and are reclaimed by the auto-cleanup cron once deleted for more than a day,
 * by a hard delete, or by manual cleanup. Removal must deregister the worktree
 * from the project repository, not just delete the directory.
 *
 * The manual sweep endpoint is not called here: tests share `WORKTREE_BASE`
 * with the dev instance, and the sweep treats every worktree unknown to the
 * test DB as orphaned.
 */
import './setup'

const DAY_MS = 24 * 60 * 60 * 1000

let gitRoot = ''
let projectId = ''
let previousAutoCleanup: string | null = null

function gitSync(args: string[], cwd: string): void {
  spawnNodeSync(['git', ...args], { cwd })
}

function branchExists(issueId: string): boolean {
  const r = spawnNodeSync(['git', 'rev-parse', '--verify', '--quiet', `bkd/${issueId}`], { cwd: gitRoot })
  return r.exitCode === 0
}

async function createWorktreeIssue(statusId = 'todo'): Promise<{ id: string, path: string }> {
  const issue = expectSuccess(
    await post<{ id: string }>(`/api/projects/${projectId}/issues`, {
      title: 'Worktree cleanup issue',
      statusId,
      engineType: 'codex',
      useWorktree: true,
    }),
  )
  const path = await createWorktree(gitRoot, projectId, issue.id)
  return { id: issue.id, path }
}

async function softDelete(issueId: string, deletedAgoMs = 0): Promise<void> {
  expectSuccess(await del(`/api/projects/${projectId}/issues/${issueId}`))
  if (deletedAgoMs > 0) {
    await db
      .update(issuesTable)
      .set({ updatedAt: new Date(Date.now() - deletedAgoMs) })
      .where(eq(issuesTable.id, issueId))
  }
}

beforeAll(async () => {
  gitRoot = mkdtempSync(join(tmpdir(), 'bkd-worktree-cleanup-repo-'))
  gitSync(['init', '-b', 'main'], gitRoot)
  gitSync(['config', 'user.email', 'test@example.com'], gitRoot)
  gitSync(['config', 'user.name', 'BKD Test'], gitRoot)
  writeFileSync(join(gitRoot, 'README.md'), 'test repo\n')
  gitSync(['add', '.'], gitRoot)
  gitSync(['commit', '-m', 'init'], gitRoot)

  projectId = await createTestProject('Worktree cleanup')
  await db.update(projectsTable).set({ directory: gitRoot }).where(eq(projectsTable.id, projectId))

  previousAutoCleanup = await getAppSetting(WORKTREE_AUTO_CLEANUP_KEY)
  await setAppSetting(WORKTREE_AUTO_CLEANUP_KEY, 'true')
})

afterAll(async () => {
  await setAppSetting(WORKTREE_AUTO_CLEANUP_KEY, previousAutoCleanup ?? 'false')
  for (const dir of [join(WORKTREE_BASE, projectId), gitRoot]) {
    try {
      if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

describe('auto-cleanup cron', () => {
  test('removes the worktree of an issue deleted more than a day ago', async () => {
    const { id, path } = await createWorktreeIssue()
    await softDelete(id, DAY_MS + 60_000)

    await runWorktreeCleanup()

    expect(existsSync(path)).toBe(false)
    expect(await isWorktreeRegistered(gitRoot, path)).toBe(false)
    expect(branchExists(id)).toBe(true)
  })

  test('keeps the worktree of a recently deleted issue for restore', async () => {
    const { id, path } = await createWorktreeIssue()
    await softDelete(id)

    await runWorktreeCleanup()

    expect(existsSync(path)).toBe(true)
  })

  test('removes a deleted issue whose session is stuck as running with no live process', async () => {
    // Deleting a running issue terminates best-effort; on failure the row
    // keeps `running`, and the reconciler skips deleted rows
    const { id, path } = await createWorktreeIssue()
    await softDelete(id)
    // One write: any update bumps updatedAt, which stands in for the deletion time
    await db
      .update(issuesTable)
      .set({ sessionStatus: 'running', updatedAt: new Date(Date.now() - DAY_MS - 60_000) })
      .where(eq(issuesTable.id, id))

    await runWorktreeCleanup()

    expect(existsSync(path)).toBe(false)
  })

  test('keeps the worktree of an issue restored while the cron runs', async () => {
    // The restore lands after the candidates are read (here, during the
    // liveness check), before the awaited removal
    const { id, path } = await createWorktreeIssue()
    await softDelete(id, DAY_MS + 60_000)
    const restoreMidway = spyOn(issueEngine, 'hasActiveProcessForIssue').mockImplementation((issueId) => {
      if (issueId === id) db.update(issuesTable).set({ isDeleted: 0 }).where(eq(issuesTable.id, id)).run()
      return false
    })
    try {
      await runWorktreeCleanup()
    } finally {
      restoreMidway.mockRestore()
    }

    expect(existsSync(path)).toBe(true)
  })

  test('keeps a deleted issue\'s worktree while its process is still alive', async () => {
    const { id, path } = await createWorktreeIssue()
    await softDelete(id, DAY_MS + 60_000)
    const live = spyOn(issueEngine, 'hasActiveProcessForIssue').mockImplementation(issueId => issueId === id)
    try {
      await runWorktreeCleanup()
    } finally {
      live.mockRestore()
    }

    expect(existsSync(path)).toBe(true)
  })

  test('keeps the worktree of a live issue', async () => {
    const { path } = await createWorktreeIssue()

    await runWorktreeCleanup()

    expect(existsSync(path)).toBe(true)
  })
})

describe('issue changes root', () => {
  test('flags a worktree issue whose worktree is gone instead of passing off the main checkout', async () => {
    const { id, path } = await createWorktreeIssue()
    const present = expectSuccess(await get<{ root: string, worktreeMissing?: boolean }>(`/api/projects/${projectId}/issues/${id}/changes`))
    expect(present.worktreeMissing).toBeFalsy()

    rmSync(path, { recursive: true, force: true })
    // The main checkout has its own change, which must not pass for the issue's
    writeFileSync(join(gitRoot, 'main-only.txt'), 'not the issue\n')
    try {
      const missing = expectSuccess(await get<{ root: string, worktreeMissing?: boolean, files: unknown[] }>(`/api/projects/${projectId}/issues/${id}/changes`))
      expect(missing.worktreeMissing).toBe(true)
      expect(missing.files).toEqual([])

      const patch = expectSuccess(await get<{ patch: string }>(`/api/projects/${projectId}/issues/${id}/changes/file?path=main-only.txt`))
      expect(patch.patch).toBe('')
    } finally {
      rmSync(join(gitRoot, 'main-only.txt'), { force: true })
    }
  })
})

describe('settings cleanup', () => {
  test('hard-deleting issues removes their worktrees from the project repo', async () => {
    const { id, path } = await createWorktreeIssue()
    await softDelete(id)

    expectSuccess(await post('/api/settings/cleanup', { targets: ['deletedIssues'] }))

    expect(existsSync(path)).toBe(false)
    expect(await isWorktreeRegistered(gitRoot, path)).toBe(false)
  })

  test('hard-deleting keeps a deleted issue whose process is still alive', async () => {
    // A failed terminate on delete leaves a live process; its worktree and row
    // must survive so auto-cleanup can still match them once it exits
    const { id, path } = await createWorktreeIssue()
    await softDelete(id)
    const live = spyOn(issueEngine, 'hasActiveProcessForIssue').mockImplementation(issueId => issueId === id)
    try {
      expectSuccess(await post('/api/settings/cleanup', { targets: ['deletedIssues'] }))
    } finally {
      live.mockRestore()
    }

    expect(existsSync(path)).toBe(true)
    const [row] = await db.select({ id: issuesTable.id }).from(issuesTable).where(eq(issuesTable.id, id))
    expect(row?.id).toBe(id)
  })

  test('an issue restored while cleanup runs keeps its row and its worktree', async () => {
    // The restore lands after cleanup has listed the deleted issues (here,
    // during its liveness check), before the destructive phase
    const { id, path } = await createWorktreeIssue()
    await softDelete(id)
    const restoreMidway = spyOn(issueEngine, 'hasActiveProcessForIssue').mockImplementation((issueId) => {
      if (issueId === id) db.update(issuesTable).set({ isDeleted: 0 }).where(eq(issuesTable.id, id)).run()
      return false
    })
    try {
      expectSuccess(await post('/api/settings/cleanup', { targets: ['deletedIssues'] }))
    } finally {
      restoreMidway.mockRestore()
    }

    const [row] = await db.select({ id: issuesTable.id, isDeleted: issuesTable.isDeleted }).from(issuesTable).where(eq(issuesTable.id, id))
    expect(row).toEqual({ id, isDeleted: 0 })
    expect(existsSync(path)).toBe(true)
  })

  test('an issue whose process comes alive while cleanup runs keeps its row and its worktree', async () => {
    // Idle when the deleted issues are listed, alive by the time its worktree
    // would go: skipping the worktree must also keep the row, or the worktree
    // is left with nothing to match it
    const { id, path } = await createWorktreeIssue()
    await softDelete(id)
    let calls = 0
    const aliveMidway = spyOn(issueEngine, 'hasActiveProcessForIssue').mockImplementation(issueId => issueId === id && ++calls > 1)
    try {
      expectSuccess(await post('/api/settings/cleanup', { targets: ['deletedIssues'] }))
    } finally {
      aliveMidway.mockRestore()
    }

    const [row] = await db.select({ id: issuesTable.id }).from(issuesTable).where(eq(issuesTable.id, id))
    expect(row?.id).toBe(id)
    expect(existsSync(path)).toBe(true)
  })

  test('manual worktree removal deregisters from the owning project repo', async () => {
    const { id, path } = await createWorktreeIssue()
    await softDelete(id)

    await removeWorktrees([{ projectDir: join(WORKTREE_BASE, projectId), issueId: id, path }])

    expect(existsSync(path)).toBe(false)
    expect(await isWorktreeRegistered(gitRoot, path)).toBe(false)
  })

  test('stats count orphaned worktrees without walking their contents', async () => {
    const { id, path } = await createWorktreeIssue()
    writeFileSync(join(path, 'big.bin'), 'x'.repeat(4096))
    await softDelete(id)

    const stats = expectSuccess(
      await get<{ worktrees: { count: number, totalSize: number } }>('/api/settings/cleanup/stats'),
    )

    expect(stats.worktrees.count).toBeGreaterThanOrEqual(1)
    expect(stats.worktrees.totalSize).toBe(0)
  })
})
