import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { carryUncommitted } from '@/services/worktree-carry'
/**
 * worktree-carry snapshot/apply tests (PLAN-021 fork mode 'snapshot').
 */
import './setup'

let repo: string
let child: string

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  await proc.exited
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'bkd-carry-'))
  await git(repo, 'init', '-q')
  await git(repo, 'config', 'user.email', 'test@test.dev')
  await git(repo, 'config', 'user.name', 'Test')
  await writeFile(join(repo, 'tracked.txt'), 'original\n')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-q', '-m', 'init')

  // Dirty the repo: modify tracked + add untracked.
  await writeFile(join(repo, 'tracked.txt'), 'modified\n')
  await writeFile(join(repo, 'untracked.txt'), 'brand new\n')

  child = join(repo, '..', 'bkd-carry-child')
  await git(repo, 'worktree', 'add', '-q', '-b', 'child', child, 'HEAD')
})

afterAll(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {})
  await rm(child, { recursive: true, force: true }).catch(() => {})
})

describe('worktree-carry', () => {
  test('carryUncommitted brings tracked + untracked changes into the child', async () => {
    const warning = await carryUncommitted(repo, child)
    expect(warning).toBeNull()

    expect(await readFile(join(child, 'tracked.txt'), 'utf8')).toBe('modified\n')
    expect(await readFile(join(child, 'untracked.txt'), 'utf8')).toBe('brand new\n')
  })

  test('parent working tree is left untouched', async () => {
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('modified\n')
    expect(await readFile(join(repo, 'untracked.txt'), 'utf8')).toBe('brand new\n')
  })

  test('carryUncommitted is a no-op warning-free run on a clean repo', async () => {
    const clean = await mkdtemp(join(tmpdir(), 'bkd-carry-clean-'))
    const cleanChild = join(clean, '..', 'bkd-carry-clean-child')
    await git(clean, 'init', '-q')
    await git(clean, 'config', 'user.email', 'test@test.dev')
    await git(clean, 'config', 'user.name', 'Test')
    await writeFile(join(clean, 'a.txt'), 'x\n')
    await git(clean, 'add', '.')
    await git(clean, 'commit', '-q', '-m', 'init')
    await git(clean, 'worktree', 'add', '-q', '-b', 'cc', cleanChild, 'HEAD')
    const warning = await carryUncommitted(clean, cleanChild)
    expect(warning).toBeNull()
    await rm(clean, { recursive: true, force: true }).catch(() => {})
    await rm(cleanChild, { recursive: true, force: true }).catch(() => {})
  })
})
