import { afterEach, describe, expect, test } from 'bun:test'
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
})
