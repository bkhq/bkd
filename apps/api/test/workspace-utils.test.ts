import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteAppSetting, setAppSetting } from '@/db/helpers'
import { isInsideWorkspace } from '@/utils/workspace'

const KEY = 'workspace:defaultPath'

describe('isInsideWorkspace', () => {
  afterEach(async () => {
    await deleteAppSetting(KEY)
  })

  test('allows everything when no workspace is configured', async () => {
    await deleteAppSetting(KEY)
    expect(await isInsideWorkspace('/anywhere')).toBe(true)
  })

  test('allows everything when the workspace is /', async () => {
    await setAppSetting(KEY, '/')
    expect(await isInsideWorkspace('/anywhere')).toBe(true)
  })

  test('allows the workspace root and paths below it', async () => {
    await setAppSetting(KEY, '/ws/root')
    expect(await isInsideWorkspace('/ws/root')).toBe(true)
    expect(await isInsideWorkspace('/ws/root/project')).toBe(true)
    expect(await isInsideWorkspace('/ws/root/a/../project')).toBe(true)
  })

  test('rejects siblings sharing the prefix and paths outside', async () => {
    await setAppSetting(KEY, '/ws/root')
    expect(await isInsideWorkspace('/ws/rootkit')).toBe(false)
    expect(await isInsideWorkspace('/ws')).toBe(false)
    expect(await isInsideWorkspace('/ws/root/../other')).toBe(false)
  })

  test('follows symlinks instead of trusting the path text', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bkd-workspace-'))
    try {
      const workspace = join(base, 'ws')
      const outside = join(base, 'outside')
      await mkdir(join(workspace, 'real'), { recursive: true })
      await mkdir(join(outside, 'secret'), { recursive: true })
      await symlink(outside, join(workspace, 'escape'))
      await symlink(join(workspace, 'real'), join(workspace, 'alias'))
      await setAppSetting(KEY, workspace)

      expect(await isInsideWorkspace(join(workspace, 'real'))).toBe(true)
      expect(await isInsideWorkspace(join(workspace, 'alias'))).toBe(true)
      expect(await isInsideWorkspace(join(workspace, 'escape'))).toBe(false)
      expect(await isInsideWorkspace(join(workspace, 'escape', 'secret'))).toBe(false)
      // Not created yet: judged by its nearest existing ancestor
      expect(await isInsideWorkspace(join(workspace, 'real', 'new', 'dir'))).toBe(true)
      expect(await isInsideWorkspace(join(workspace, 'escape', 'new'))).toBe(false)
    } finally {
      await rm(base, { recursive: true })
    }
  })

  test('accepts a workspace root that is itself a symlink', async () => {
    const base = await mkdtemp(join(tmpdir(), 'bkd-workspace-'))
    try {
      await mkdir(join(base, 'actual', 'project'), { recursive: true })
      await symlink(join(base, 'actual'), join(base, 'link'))
      await setAppSetting(KEY, join(base, 'link'))

      expect(await isInsideWorkspace(join(base, 'link', 'project'))).toBe(true)
      expect(await isInsideWorkspace(join(base, 'actual', 'project'))).toBe(true)
    } finally {
      await rm(base, { recursive: true })
    }
  })
})
