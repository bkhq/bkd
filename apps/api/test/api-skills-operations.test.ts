import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillsCliRunner } from '@/skills/cli'
import { resetSkillsOperations, setSkillsCliRunner } from '@/skills/cli'
import { expectError, expectSuccess, get, post, waitFor } from './helpers'
/**
 * Install / update / uninstall through the skills CLI. The CLI is replaced by
 * a fake runner: these tests never touch the network or the real HOME.
 */
import './setup'

interface Operation {
  id: string
  op: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  output: string[]
  error: string | null
  result: { skills?: { name: string, description: string }[] } | null
}

interface Call { args: string[], cwd: string, home: string | undefined, stateHome: string | undefined }

let home: string
const originalHome = process.env.HOME
let calls: Call[] = []
/** What the next CLI run does; default: succeed with no output. */
let behaviour: (call: Call, onLine: (line: string) => void, signal: AbortSignal) => Promise<{ exitCode: number, stdout: string }>

const fakeRunner: SkillsCliRunner = (args, { cwd, env, onLine, signal }) => {
  const call = { args, cwd, home: env.HOME, stateHome: env.XDG_STATE_HOME }
  calls.push(call)
  return behaviour(call, onLine, signal)
}

function writeSkill(dir: string, name: string, description: string) {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n`)
}

async function finished(id: string): Promise<Operation> {
  let op: Operation | undefined
  await waitFor(async () => {
    op = expectSuccess(await get<Operation>(`/api/skills/operations/${id}`))
    return op.status !== 'running'
  }, 3000, 20)
  return op!
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'bkd-skills-ops-home-'))
  process.env.HOME = home
  writeSkill(join(home, '.agents/skills'), 'pma', 'Project management')
  writeSkill(join(home, '.agents/skills'), 'mine', 'Local one')
  writeFileSync(join(home, '.agents/.skill-lock.json'), JSON.stringify({ version: 3, skills: { pma: { source: 'zzci/skills' } } }))
  setSkillsCliRunner(fakeRunner)
})

afterEach(() => {
  calls = []
  behaviour = async () => ({ exitCode: 0, stdout: '' })
  resetSkillsOperations()
})

afterAll(() => {
  setSkillsCliRunner(null)
  process.env.HOME = originalHome
  rmSync(home, { recursive: true, force: true })
})

describe('preview', () => {
  test('installs into a throwaway HOME and reports the repo skills with descriptions', async () => {
    behaviour = async (call) => {
      // The CLI writes the skills under the HOME it was given
      writeSkill(join(call.home!, '.agents/skills'), 'alpha', 'First skill')
      writeSkill(join(call.home!, '.agents/skills'), 'beta', 'Second skill')
      const stdout = JSON.stringify([
        { name: 'alpha', status: 'installed', path: join(call.home!, '.agents/skills/alpha') },
        { name: 'beta', status: 'installed', path: join(call.home!, '.agents/skills/beta') },
      ])
      return { exitCode: 0, stdout }
    }
    const started = expectSuccess(await post<Operation>('/api/skills/operations', { op: 'preview', source: 'zzci/skills', scope: 'global' }))
    const op = await finished(started.id)
    expect(op.status).toBe('succeeded')
    expect(op.result?.skills).toEqual([
      { name: 'alpha', description: 'First skill' },
      { name: 'beta', description: 'Second skill' },
    ])
    expect(calls[0]!.args).toEqual(['add', 'zzci/skills', '-s', '*', '-a', 'codex', '-g', '-y', '--json'])
    // Never the real HOME
    expect(calls[0]!.home).not.toBe(home)
  })

  test('keeps the CLI lock in the throwaway HOME when XDG_STATE_HOME is set', async () => {
    // skills@1.7.4 keeps its global lock under $XDG_STATE_HOME when set; a preview must not touch the real one
    process.env.XDG_STATE_HOME = join(home, '.local/state')
    try {
      const started = expectSuccess(await post<Operation>('/api/skills/operations', { op: 'preview', source: 'zzci/skills', scope: 'global' }))
      await finished(started.id)
      expect(calls[0]!.stateHome?.startsWith(calls[0]!.home!)).toBe(true)
    } finally {
      delete process.env.XDG_STATE_HOME
    }
  })
})

describe('add, update, remove', () => {
  test('installs the chosen skills globally for the chosen agents', async () => {
    behaviour = async () => ({ exitCode: 0, stdout: JSON.stringify([{ name: 'alpha', status: 'installed' }]) })
    const started = expectSuccess(await post<Operation>('/api/skills/operations', {
      op: 'add',
      source: 'https://github.com/zzci/skills',
      skills: ['alpha'],
      agents: ['claude-code', 'codex'],
      scope: 'global',
    }))
    expect((await finished(started.id)).status).toBe('succeeded')
    expect(calls[0]).toMatchObject({
      args: ['add', 'https://github.com/zzci/skills', '-s', 'alpha', '-a', 'claude-code', 'codex', '-g', '-y', '--json'],
      cwd: home,
      home,
    })
  })

  test('reports skills the CLI failed to install', async () => {
    behaviour = async () => ({ exitCode: 0, stdout: JSON.stringify([{ name: 'alpha', status: 'failed', error: 'boom' }]) })
    const started = expectSuccess(await post<Operation>('/api/skills/operations', { op: 'add', source: 'zzci/skills', skills: ['alpha'], scope: 'global' }))
    const op = await finished(started.id)
    expect(op.status).toBe('failed')
    expect(op.error).toContain('alpha: boom')
  })

  test('updates installed skills, all of them when no names are given', async () => {
    const started = expectSuccess(await post<Operation>('/api/skills/operations', { op: 'update', scope: 'global' }))
    expect((await finished(started.id)).status).toBe('succeeded')
    expect(calls[0]!.args).toEqual(['update', '-g', '-y'])
  })

  test('uninstalls an installed skill', async () => {
    const started = expectSuccess(await post<Operation>('/api/skills/operations', { op: 'remove', names: ['pma'], scope: 'global' }))
    expect((await finished(started.id)).status).toBe('succeeded')
    expect(calls[0]!.args).toEqual(['remove', 'pma', '-g', '-y'])
  })

  test('refuses to uninstall a name that is not an installed skill (the CLI would report success)', async () => {
    expectError(await post('/api/skills/operations', { op: 'remove', names: ['mine'], scope: 'global' }), 400)
    expectError(await post('/api/skills/operations', { op: 'remove', names: ['ghost'], scope: 'global' }), 400)
    expect(calls).toEqual([])
  })

  test('fails the operation when the CLI exits non-zero, keeping its output', async () => {
    behaviour = async (_call, onLine) => {
      onLine('error: could not clone repository')
      return { exitCode: 1, stdout: '' }
    }
    const started = expectSuccess(await post<Operation>('/api/skills/operations', { op: 'update', scope: 'global' }))
    const op = await finished(started.id)
    expect(op.status).toBe('failed')
    expect(op.output).toContain('error: could not clone repository')
  })
})

describe('validation and concurrency', () => {
  test('rejects sources that are not a GitHub owner/repo or URL, and bad names', async () => {
    for (const source of ['../etc', 'git@github.com:a/b.git', 'https://evil.example.com/a/b', '-g', 'a/b; rm -rf /']) {
      expectError(await post('/api/skills/operations', { op: 'preview', source, scope: 'global' }), 400)
    }
    expectError(await post('/api/skills/operations', { op: 'add', source: 'zzci/skills', skills: ['--all'], scope: 'global' }), 400)
    expect(calls).toEqual([])
  })

  test('runs one operation at a time and can cancel it', async () => {
    behaviour = (_call, _onLine, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ exitCode: 143, stdout: '' }))
    })
    const first = expectSuccess(await post<Operation>('/api/skills/operations', { op: 'update', scope: 'global' }))
    expectError(await post('/api/skills/operations', { op: 'update', scope: 'global' }), 409)
    expectSuccess(await post(`/api/skills/operations/${first.id}/cancel`, {}))
    expect((await finished(first.id)).status).toBe('cancelled')
    // Free again
    behaviour = async () => ({ exitCode: 0, stdout: '' })
    expectSuccess(await post<Operation>('/api/skills/operations', { op: 'update', scope: 'global' }))
  })

  test('reports whether the CLI can run on this server', async () => {
    const data = expectSuccess(await get<{ cliAvailable: boolean }>('/api/skills'))
    expect(typeof data.cliAvailable).toBe('boolean')
  })
})

describe('project whose directory is HOME', () => {
  test('refuses project-scoped CLI operations: its store is the global one', async () => {
    const project = expectSuccess(await post<{ id: string }>('/api/projects', { name: 'Home Ops', directory: home }))
    for (const body of [
      { op: 'add', source: 'zzci/skills', skills: ['alpha'], scope: 'project', projectId: project.id },
      { op: 'update', scope: 'project', projectId: project.id },
    ]) {
      expectError(await post('/api/skills/operations', body), 400)
    }
    expect(calls).toEqual([])
  })
})
