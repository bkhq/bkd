import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  cleanupWorktree,
  createWorktree,
  removeWorktree,
  resolveWorktreePath,
} from '@/engines/issue/utils/worktree'
import { ROOT_DIR } from '@/root'

/**
 * Worktree utility tests — verifies:
 * 1. resolveWorktreePath returns deterministic path under ROOT_DIR/data/worktrees/
 * 2. createWorktree creates a git worktree and returns its path
 * 3. removeWorktree removes the git worktree and cleans up the directory
 * 4. removeWorktree falls back to directory deletion when git command fails
 * 5. cleanupWorktree calls removeWorktree (fire-and-forget)
 *
 * These tests use the actual git repo since worktree operations require it.
 */

// Git repo root (2 levels up from apps/api/test/)
const GIT_ROOT = resolve(import.meta.dir, '../../..')
const TEST_PROJECT_ID = 'test-project'
const TEST_ISSUE_ID = `test-wt-${Date.now()}`

afterAll(() => {
  // Clean up any leftover worktrees and branches
  const wtDir = resolveWorktreePath(TEST_PROJECT_ID, TEST_ISSUE_ID)
  try {
    if (existsSync(wtDir)) {
      Bun.spawnSync(['git', 'worktree', 'remove', '--force', wtDir], {
        cwd: GIT_ROOT,
      })
    }
  } catch {
    /* best effort */
  }
  try {
    Bun.spawnSync(['git', 'branch', '-D', `bitk/${TEST_ISSUE_ID}`], {
      cwd: GIT_ROOT,
    })
  } catch {
    /* best effort */
  }
  // Clean up the test project directory under data/worktrees/
  try {
    const projectDir = join(ROOT_DIR, 'data/worktrees', TEST_PROJECT_ID)
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true })
    }
  } catch {
    /* best effort */
  }
})

describe('resolveWorktreePath', () => {
  test('returns deterministic path under ROOT_DIR/data/worktrees/', () => {
    const path = resolveWorktreePath('proj-1', 'issue-abc')
    expect(path).toBe(join(ROOT_DIR, 'data/worktrees', 'proj-1', 'issue-abc'))
  })
})

describe('createWorktree', () => {
  test('creates a worktree directory with the expected path', async () => {
    const worktreeDir = await createWorktree(
      GIT_ROOT,
      TEST_PROJECT_ID,
      TEST_ISSUE_ID,
    )
    expect(worktreeDir).toBe(
      resolveWorktreePath(TEST_PROJECT_ID, TEST_ISSUE_ID),
    )
    expect(existsSync(worktreeDir)).toBe(true)

    // Verify it's a valid git worktree (has .git file)
    expect(existsSync(join(worktreeDir, '.git'))).toBe(true)
  })

  test('retries with existing branch on second call', async () => {
    // The branch already exists from the first test — createWorktree
    // should handle this gracefully by retrying without -b
    const wtDir = resolveWorktreePath(TEST_PROJECT_ID, TEST_ISSUE_ID)
    await removeWorktree(GIT_ROOT, wtDir)

    const worktreeDir = await createWorktree(
      GIT_ROOT,
      TEST_PROJECT_ID,
      TEST_ISSUE_ID,
    )
    expect(existsSync(worktreeDir)).toBe(true)
  })
})

describe('removeWorktree', () => {
  test('removes worktree via git command', async () => {
    const wtDir = resolveWorktreePath(TEST_PROJECT_ID, TEST_ISSUE_ID)
    expect(existsSync(wtDir)).toBe(true)

    await removeWorktree(GIT_ROOT, wtDir)
    expect(existsSync(wtDir)).toBe(false)
  })

  test('falls back to directory deletion for non-git worktree dirs', async () => {
    const fakeDir = join(
      ROOT_DIR,
      'data/worktrees',
      TEST_PROJECT_ID,
      'fake-worktree',
    )
    mkdirSync(fakeDir, { recursive: true })
    writeFileSync(join(fakeDir, 'test.txt'), 'test')
    expect(existsSync(fakeDir)).toBe(true)

    await removeWorktree(GIT_ROOT, fakeDir)
    expect(existsSync(fakeDir)).toBe(false)
  })
})

describe('cleanupWorktree', () => {
  test('calls removeWorktree as fire-and-forget', async () => {
    const cleanupIssueId = `test-cleanup-${Date.now()}`
    const wtDir = await createWorktree(
      GIT_ROOT,
      TEST_PROJECT_ID,
      cleanupIssueId,
    )

    expect(existsSync(wtDir)).toBe(true)

    // cleanupWorktree is fire-and-forget — pass baseDir explicitly
    cleanupWorktree(GIT_ROOT, cleanupIssueId, wtDir)

    // Wait for the async cleanup to complete
    await Bun.sleep(1000)

    expect(existsSync(wtDir)).toBe(false)

    // Clean up branch
    Bun.spawnSync(['git', 'branch', '-D', `bitk/${cleanupIssueId}`], {
      cwd: GIT_ROOT,
    })
  })
})
