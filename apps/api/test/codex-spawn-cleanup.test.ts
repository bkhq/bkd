import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { CodexExecutor } from '@/engines/executors/codex/executor'
import * as spawnModule from '@/engines/spawn'
import { waitFor } from './helpers'
/**
 * A failed Codex handshake must not leave `codex app-server` running.
 *
 * An orphaned app-server keeps the thread's writer lock, so every later
 * follow-up on the thread is rejected with "already has an active writer"
 * and leaks one more process.
 */
import './setup'

const FAKE = resolve(import.meta.dir, 'fixtures/fake-codex-app-server.ts')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('CodexExecutor handshake failure', () => {
  test('rejected thread/resume leaves no app-server running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bkd-fake-codex-'))
    tempDirs.push(dir)
    const pidFile = join(dir, 'pid')

    const realSpawnNode = spawnModule.spawnNode
    const spy = spyOn(spawnModule, 'spawnNode').mockImplementation((_cmd, options) =>
      realSpawnNode([process.execPath, FAKE, pidFile], options),
    )
    let pid: number | undefined
    try {
      await expect(
        new CodexExecutor().spawnFollowUp(
          { workingDir: dir, prompt: 'again', sessionId: 'thread-1', permissionMode: 'auto' },
          { vars: {}, workingDir: dir, projectId: 'p', issueId: 'i' },
        ),
      ).rejects.toThrow('already has an active writer')

      pid = Number(readFileSync(pidFile, 'utf-8'))
      await waitFor(async () => !isAlive(pid!), 3000, 50)
    } finally {
      spy.mockRestore()
      if (pid && isAlive(pid)) process.kill(-pid, 9)
    }
  })
})
