import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { api, del, expectError, expectSuccess, get, post } from './helpers'
/**
 * Skills management API: skills are read from the agent skill directories under
 * HOME and the project, never through an engine CLI.
 */
import './setup'

interface Skill {
  location: string
  scope: 'global' | 'project'
  name: string
  description: string
  path: string
  managed: boolean
  source: string | null
  agents: string[]
}

let home: string
let projectDir: string
let projectId: string
const originalHome = process.env.HOME

function writeSkill(dir: string, name: string, description: string, body = 'Body') {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
}

function put<T>(path: string, body: unknown) {
  return api<T>('PUT', path, body)
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'bkd-skills-home-'))
  process.env.HOME = home
  process.env.BKD_SKILLS_TRASH_DIR = join(home, 'trash')
  const agents = join(home, '.agents/skills')
  const claude = join(home, '.claude/skills')
  mkdirSync(claude, { recursive: true })
  // Installed by the skills CLI: tracked in the lock, linked into ~/.claude/skills
  writeSkill(agents, 'pma', 'Project management', 'Managed body')
  symlinkSync('../../.agents/skills/pma', join(claude, 'pma'))
  // In the shared store but not tracked by the lock: a local skill
  writeSkill(agents, 'local-notes', '"Quoted description"')
  // A real directory in ~/.claude/skills: Claude Code only
  writeSkill(claude, 'claude-only', 'Only for Claude')
  // Not a skill (no SKILL.md)
  mkdirSync(join(claude, 'synced/abc'), { recursive: true })
  writeFileSync(join(home, '.agents/.skill-lock.json'), JSON.stringify({
    version: 3,
    skills: { pma: { source: 'zzci/skills', sourceUrl: 'https://github.com/zzci/skills.git', updatedAt: '2026-09-09T15:40:10.385Z' } },
  }))

  projectDir = mkdtempSync(join(tmpdir(), 'bkd-skills-project-'))
  writeSkill(join(projectDir, '.claude/skills'), 'deploy', 'Deploy this project')
  const created = expectSuccess(await post<{ id: string }>('/api/projects', { name: 'Skills Project', directory: projectDir }))
  projectId = created.id
})

afterAll(() => {
  process.env.HOME = originalHome
  delete process.env.BKD_SKILLS_TRASH_DIR
  rmSync(home, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

describe('GET /api/skills', () => {
  test('lists global skills with source, managed flag and agents', async () => {
    const data = expectSuccess(await get<{ skills: Skill[] }>('/api/skills'))
    const byName = Object.fromEntries(data.skills.map(s => [s.name, s]))
    expect(Object.keys(byName).sort()).toEqual(['claude-only', 'local-notes', 'pma'])

    expect(byName.pma).toMatchObject({ location: 'global-agents', scope: 'global', managed: true, source: 'zzci/skills', description: 'Project management' })
    expect(byName.pma!.agents.sort()).toEqual(['claude-code', 'codex'])
    expect(byName['local-notes']).toMatchObject({ managed: false, source: null, description: 'Quoted description' })
    expect(byName['local-notes']!.agents).toEqual(['codex'])
    expect(byName['claude-only']).toMatchObject({ location: 'global-claude', managed: false, agents: ['claude-code'] })
  })

  test('adds the project skills when a project is given', async () => {
    const data = expectSuccess(await get<{ skills: Skill[] }>(`/api/skills?projectId=${projectId}`))
    const deploy = data.skills.find(s => s.name === 'deploy')
    expect(deploy).toMatchObject({ location: 'project-claude', scope: 'project', managed: false })
  })

  test('rejects an unknown project', async () => {
    expectError(await get('/api/skills?projectId=nope0000'), 404)
  })
})

describe('skill files', () => {
  test('lists files and reads one', async () => {
    const files = expectSuccess(await get<{ path: string, type: string, size: number }[]>('/api/skills/global-agents/pma/files'))
    expect(files).toEqual([{ path: 'SKILL.md', type: 'file', size: expect.any(Number) }])
    const file = expectSuccess(await get<{ content: string }>('/api/skills/global-agents/pma/file?path=SKILL.md'))
    expect(file.content).toContain('Managed body')
  })

  test('saves a local skill file, creating new files inside the skill', async () => {
    expectSuccess(await put('/api/skills/global-agents/local-notes/file', { path: 'SKILL.md', content: 'edited' }))
    expect(readFileSync(join(home, '.agents/skills/local-notes/SKILL.md'), 'utf8')).toBe('edited')
    expectSuccess(await put('/api/skills/global-agents/local-notes/file', { path: 'references/a.md', content: 'ref' }))
    expect(readFileSync(join(home, '.agents/skills/local-notes/references/a.md'), 'utf8')).toBe('ref')
  })

  test('refuses to write a managed skill, which the CLI would overwrite', async () => {
    expectError(await put('/api/skills/global-agents/pma/file', { path: 'SKILL.md', content: 'x' }), 409)
  })

  test('refuses paths outside the skill and invalid names', async () => {
    expectError(await get('/api/skills/global-agents/pma/file?path=../local-notes/SKILL.md'), 400)
    expectError(await put('/api/skills/global-agents/local-notes/file', { path: '../../escape.md', content: 'x' }), 400)
    expectError(await get('/api/skills/global-agents/..%2Fx/files'), 400)
    expectError(await get('/api/skills/global-agents/missing/files'), 404)
  })
})

describe('create, copy, delete', () => {
  test('creates a global skill in the shared store and links it for Claude Code', async () => {
    const skill = expectSuccess(await post<Skill>('/api/skills', { scope: 'global', name: 'new-skill', description: 'Does things' }))
    expect(skill).toMatchObject({ location: 'global-agents', name: 'new-skill', managed: false })
    expect(skill.agents.sort()).toEqual(['claude-code', 'codex'])
    expect(readFileSync(join(home, '.agents/skills/new-skill/SKILL.md'), 'utf8')).toContain('description: "Does things"') // quoted: descriptions often contain ':'
    expect(lstatSync(join(home, '.claude/skills/new-skill')).isSymbolicLink()).toBe(true)
    expectError(await post('/api/skills', { scope: 'global', name: 'new-skill', description: 'again' }), 409)
  })

  test('creates a project skill', async () => {
    const skill = expectSuccess(await post<Skill>('/api/skills', { scope: 'project', projectId, name: 'proj-new', description: 'P' }))
    expect(skill.location).toBe('project-agents')
    expect(existsSync(join(projectDir, '.agents/skills/proj-new/SKILL.md'))).toBe(true)
    expect(readlinkSync(join(projectDir, '.claude/skills/proj-new'))).toBe('../../.agents/skills/proj-new')
  })

  test('copies a managed skill to a new local name', async () => {
    const copy = expectSuccess(await post<Skill>('/api/skills/global-agents/pma/copy', { name: 'pma-mine' }))
    expect(copy).toMatchObject({ name: 'pma-mine', managed: false, location: 'global-agents' })
    expect(readFileSync(join(home, '.agents/skills/pma-mine/SKILL.md'), 'utf8')).toContain('Managed body')
  })

  test('deletes a local skill into the trash and drops its link', async () => {
    expectSuccess(await del('/api/skills/global-agents/new-skill'))
    expect(existsSync(join(home, '.agents/skills/new-skill'))).toBe(false)
    expect(existsSync(join(home, '.claude/skills/new-skill'))).toBe(false)
    expect(lstatSync(join(home, '.claude/skills/pma')).isSymbolicLink()).toBe(true)
    const trash = join(home, 'trash')
    expect(existsSync(trash)).toBe(true)
  })

  test('refuses to delete a managed skill', async () => {
    expectError(await del('/api/skills/global-agents/pma'), 409)
  })
})
