import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { CodexExecutor } from '@/engines/executors/codex/executor'
import * as spawnModule from '@/engines/spawn'
import './setup'

const savedEnv = { PATH: process.env.PATH, HOME: process.env.HOME }
const tempDirs: string[] = []

afterEach(() => {
  process.env.PATH = savedEnv.PATH
  process.env.HOME = savedEnv.HOME
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const hostHasCodex = existsSync('/work/bin/codex') || existsSync('/usr/local/bin/codex')

describe('CodexExecutor.getModels without a codex binary', () => {
  test.skipIf(hostHasCodex)('returns no models and spawns nothing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'bkd-no-codex-'))
    tempDirs.push(empty)
    process.env.PATH = empty
    process.env.HOME = empty

    const spy = spyOn(spawnModule, 'spawnNode')
    try {
      expect(await new CodexExecutor().getModels()).toEqual([])
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
