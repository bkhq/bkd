import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expectSuccess, post } from './helpers'
import app from '@/app'
import './setup'

/** `/api/skills/fm/:projectId` — the file manager over skill directories, one mount per skill. */

let home: string
let projectDir: string
let projectId: string
let outside: string
const originalHome = process.env.HOME
const originalFmData = process.env.BKD_FM_DATA_DIR

function writeSkill(dir: string, name: string, description: string) {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`)
}

const fm = (scope: string, path: string, init?: RequestInit) => app.request(`http://localhost/api/skills/fm/${scope}${path}`, init)
const mountIds = async (scope: string) => ((await (await fm(scope, '/mounts')).json()) as { mounts: Array<{ id: string }> }).mounts.map(m => m.id).sort()
const write = (scope: string, mount: string, path: string, body: string) =>
  fm(scope, `/m/${encodeURIComponent(mount)}/write?path=${encodeURIComponent(path)}`, { method: 'PUT', body })

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'bkd-skills-fm-home-'))
  process.env.HOME = home
  process.env.BKD_FM_DATA_DIR = join(home, 'fm-data')
  outside = mkdtempSync(join(tmpdir(), 'bkd-skills-fm-outside-'))
  writeFileSync(join(outside, 'secret.txt'), 'secret')

  const agents = join(home, '.agents/skills')
  writeSkill(agents, 'pma', 'Managed')
  writeSkill(agents, 'notes', 'Local')
  symlinkSync(join(outside, 'secret.txt'), join(agents, 'notes/leak.txt'))
  writeSkill(join(home, '.claude/skills'), 'claude-only', 'Claude only')
  writeFileSync(join(home, '.agents/.skill-lock.json'), JSON.stringify({ version: 3, skills: { pma: { source: 'zzci/skills' } } }))

  projectDir = mkdtempSync(join(tmpdir(), 'bkd-skills-fm-project-'))
  writeSkill(join(projectDir, '.claude/skills'), 'deploy', 'Deploy')
  projectId = expectSuccess(await post<{ id: string }>('/api/projects', { name: 'Skills FM', directory: projectDir })).id
})

afterAll(() => {
  process.env.HOME = originalHome
  if (originalFmData === undefined) delete process.env.BKD_FM_DATA_DIR
  else process.env.BKD_FM_DATA_DIR = originalFmData
  for (const dir of [home, projectDir, outside]) rmSync(dir, { recursive: true, force: true })
})

describe('mounts', () => {
  test('global scope lists one mount per global skill', async () => {
    expect(await mountIds('global')).toEqual(['global-agents~notes', 'global-agents~pma', 'global-claude~claude-only'])
  })

  test('a project adds its project skills', async () => {
    expect(await mountIds(projectId)).toContain('project-claude~deploy')
  })

  test('an unknown project serves nothing', async () => {
    expect(await mountIds('nope1234')).toEqual([])
  })

  test('reveals each skill\'s real directory for "Copy path"', async () => {
    const { mounts } = (await (await fm('global', '/mounts')).json()) as { mounts: Array<{ id: string, absoluteRoot?: string }> }
    expect(mounts.find(m => m.id === 'global-agents~notes')?.absoluteRoot).toBe(realpathSync(join(home, '.agents/skills/notes')))
  })
})

describe('access', () => {
  test('reads a skill file', async () => {
    const res = await fm('global', `/m/${encodeURIComponent('global-agents~pma')}/read?path=/SKILL.md`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Managed')
    expect(res.headers.get('content-security-policy')).toContain('frame-ancestors \'self\'')
  })

  test('refuses writes to a managed skill', async () => {
    const res = await write('global', 'global-agents~pma', '/SKILL.md', 'x')
    expect(res.status).toBe(403)
    expect(readFileSync(join(home, '.agents/skills/pma/SKILL.md'), 'utf8')).toContain('Managed')
  })

  test('writes a local skill and deletes into the fm trash, outside the skill', async () => {
    expect((await write('global', 'global-agents~notes', '/refs/a.md', 'ref')).status).toBe(200)
    expect(readFileSync(join(home, '.agents/skills/notes/refs/a.md'), 'utf8')).toBe('ref')

    const res = await fm('global', `/m/${encodeURIComponent('global-agents~notes')}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', paths: ['/refs/a.md'] }),
    })
    expect(res.status).toBe(200)
    expect(existsSync(join(home, '.agents/skills/notes/refs/a.md'))).toBe(false)
    expect(existsSync(join(home, '.agents/skills/notes/.fm-trash'))).toBe(false)
    expect(readdirSync(join(home, 'fm-data')).length).toBe(1)
  })

  test('does not follow a symlink out of the skill', async () => {
    const res = await fm('global', `/m/${encodeURIComponent('global-agents~notes')}/read?path=/leak.txt`)
    expect(res.status).toBe(404)
  })

  test('a mount of one skill cannot reach a sibling skill', async () => {
    const res = await fm('global', `/m/${encodeURIComponent('global-agents~notes')}/read?path=/../pma/SKILL.md`)
    expect(res.status).not.toBe(200)
  })

  test('project skills are read-only when the project store links outside the project', async () => {
    const project = mkdtempSync(join(tmpdir(), 'bkd-skills-fm-linked-'))
    // .claude/skills is real, .agents links to a directory outside the project
    writeSkill(join(project, '.claude/skills'), 'own', 'Own')
    symlinkSync(outside, join(project, '.agents'))
    const id = expectSuccess(await post<{ id: string }>('/api/projects', { name: 'Linked', directory: project })).id
    try {
      expect(await mountIds(id)).toContain('project-claude~own')
      const res = await write(id, 'project-claude~own', '/SKILL.md', 'x')
      expect(res.status).toBe(403)
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })
})
