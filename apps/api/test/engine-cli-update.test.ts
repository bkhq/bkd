import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineUpdate } from '@bkd/shared'
import { cacheDel } from '@/cache'
import { getProbeResults, saveProbeResults } from '@/db/helpers'
import { setCliUpdateRunner } from '@/engines/cli-update'
import type { CliUpdateRunner } from '@/engines/cli-update'
import app from '@/app'
import './setup'

/** `POST /api/engines/:engineType/update` — runs the engine CLI's own updater. */

const dir = mkdtempSync(join(tmpdir(), 'bkd-cli-update-'))
const claudeBin = join(dir, 'claude')
writeFileSync(claudeBin, '')

const calls: string[][] = []
let version = '2.1.300'
let updateExit = 0
let release: (() => void) | null = null

const fakeRunner: CliUpdateRunner = async (argv, { onLine }) => {
  calls.push(argv)
  if (argv[1] === '--version') {
    onLine(`${version} (Claude Code)`)
    return 0
  }
  onLine('Checking for updates...')
  if (release === null) {
    await new Promise<void>((resolve) => {
      release = resolve
    })
  }
  if (updateExit === 0) version = '2.1.322'
  onLine(updateExit === 0 ? 'Successfully updated' : 'Update failed')
  return updateExit
}

async function seedDiscovery() {
  await cacheDel('engines:available')
  await saveProbeResults(
    [{ engineType: 'claude-code', installed: true, version: '2.1.300', binaryPath: claudeBin, authStatus: 'authenticated' }],
    {},
  )
}

const startUpdate = (engineType: string) => app.request(`http://localhost/api/engines/${engineType}/update`, { method: 'POST' })
async function waitFor(id: string): Promise<EngineUpdate> {
  for (let i = 0; i < 100; i++) {
    const res = await app.request(`http://localhost/api/engines/updates/${id}`)
    const op = ((await res.json()) as { data: EngineUpdate }).data
    if (op.status !== 'running') return op
    await Bun.sleep(10)
  }
  throw new Error('update did not finish')
}

beforeEach(async () => {
  calls.length = 0
  version = '2.1.300'
  updateExit = 0
  release = () => {}
  setCliUpdateRunner(fakeRunner)
  await seedDiscovery()
})

afterEach(() => setCliUpdateRunner(null))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('engine CLI update', () => {
  test('runs `<binary> update` and records the new version', async () => {
    const res = await startUpdate('claude-code')
    expect(res.status).toBe(202)
    const op = await waitFor(((await res.json()) as { data: EngineUpdate }).data.id)

    expect(op.status).toBe('succeeded')
    expect(op.fromVersion).toBe('2.1.300')
    expect(op.toVersion).toBe('2.1.322')
    expect(op.output).toContain('Successfully updated')
    expect(calls[0]).toEqual([claudeBin, 'update'])
    const stored = await getProbeResults()
    expect(stored!.engines.find(e => e.engineType === 'claude-code')?.version).toBe('2.1.322')
  })

  test('a failed update keeps the recorded version', async () => {
    updateExit = 1
    const res = await startUpdate('claude-code')
    const op = await waitFor(((await res.json()) as { data: EngineUpdate }).data.id)

    expect(op.status).toBe('failed')
    expect(op.error).toContain('1')
    const stored = await getProbeResults()
    expect(stored!.engines.find(e => e.engineType === 'claude-code')?.version).toBe('2.1.300')
  })

  test('runs one update at a time', async () => {
    release = null
    const first = await startUpdate('claude-code')
    expect(first.status).toBe(202)
    expect((await startUpdate('claude-code')).status).toBe(409)
    release!()
    await waitFor(((await first.json()) as { data: EngineUpdate }).data.id)
  })

  test('refuses an engine without an updater', async () => {
    expect((await startUpdate('grok')).status).toBe(400)
  })

  test('refuses an engine that is not installed', async () => {
    expect((await startUpdate('codex')).status).toBe(400)
  })

  test('404 for an unknown update id', async () => {
    expect((await app.request('http://localhost/api/engines/updates/nope')).status).toBe(404)
  })
})
