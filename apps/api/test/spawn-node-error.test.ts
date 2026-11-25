import { describe, expect, test } from 'bun:test'
import { spawnNode } from '@/engines/spawn'

const failure = (promise: Promise<unknown>) => promise.then(() => null, (err: Error) => err)

describe('spawnNode with a missing executable', () => {
  test('stdout and stderr fail with the spawn error, not AbortError', async () => {
    const proc = spawnNode(['bkd-no-such-binary'], { detached: false })

    const [stdoutErr, stderrErr, exitErr] = await Promise.all([
      failure(proc.stdout.getReader().read()),
      failure(proc.stderr.getReader().read()),
      failure(proc.exited),
    ])
    for (const err of [stdoutErr, stderrErr, exitErr]) {
      expect(err?.message).toContain('bkd-no-such-binary')
    }
  })
})
