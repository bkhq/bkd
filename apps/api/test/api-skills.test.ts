import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  sourcePath: string | null
  sourceRef: string | null
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
    skills: { pma: { source: 'zzci/skills', sourceUrl: 'https://github.com/zzci/skills.git', skillPath: 'skills/pma/SKILL.md', updatedAt: '2026-09-09T15:40:10.385Z' } },
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

    expect(byName.pma).toMatchObject({ location: 'global-agents', scope: 'global', managed: true, source: 'zzci/skills', sourcePath: 'skills/pma', description: 'Project management' })
    expect(byName['local-notes']!.sourcePath).toBeNull()
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

describe('project directory that is HOME', () => {
  test('does not list the global skills a second time as editable project skills', async () => {
    // A project rooted at HOME has HOME/.agents/skills as its "project" store: the
    // global store, whose lock is HOME/.agents/.skill-lock.json, not a project lock.
    const homeProject = expectSuccess(await post<{ id: string }>('/api/projects', { name: 'Home Project', directory: home }))
    const data = expectSuccess(await get<{ skills: Skill[] }>(`/api/skills?projectId=${homeProject.id}`))
    expect(data.skills.filter(s => s.scope === 'project')).toEqual([])
    expectError(await put('/api/skills/project-agents/pma/file', { path: 'SKILL.md', content: 'x', projectId: homeProject.id }), 404)
  })
})

describe('roots resolved like the skills CLI', () => {
  test('reads the global lock from XDG_STATE_HOME and Claude skills from CLAUDE_CONFIG_DIR when set', async () => {
    const state = mkdtempSync(join(tmpdir(), 'bkd-skills-state-'))
    const claudeConfig = mkdtempSync(join(tmpdir(), 'bkd-skills-claude-'))
    mkdirSync(join(state, 'skills'), { recursive: true })
    writeFileSync(join(state, 'skills/.skill-lock.json'), JSON.stringify({ version: 3, skills: { 'local-notes': { source: 'me/notes' } } }))
    writeSkill(join(claudeConfig, 'skills'), 'from-config-dir', 'In CLAUDE_CONFIG_DIR')
    process.env.XDG_STATE_HOME = state
    process.env.CLAUDE_CONFIG_DIR = claudeConfig
    try {
      const data = expectSuccess(await get<{ skills: Skill[] }>('/api/skills'))
      const byName = Object.fromEntries(data.skills.map(s => [s.name, s]))
      expect(byName['local-notes']).toMatchObject({ managed: true, source: 'me/notes' })
      expect(byName.pma).toMatchObject({ managed: false })
      expect(byName['from-config-dir']).toMatchObject({ location: 'global-claude' })
      expect(byName['claude-only']).toBeUndefined()
    } finally {
      delete process.env.XDG_STATE_HOME
      delete process.env.CLAUDE_CONFIG_DIR
      rmSync(state, { recursive: true, force: true })
      rmSync(claudeConfig, { recursive: true, force: true })
    }
  })
})

describe('unreadable lock', () => {
  test('keeps every store skill read-only when the lock exists but cannot be parsed', async () => {
    // A broken lock must not turn CLI-installed skills into editable local ones
    const state = mkdtempSync(join(tmpdir(), 'bkd-skills-badlock-'))
    mkdirSync(join(state, 'skills'), { recursive: true })
    writeFileSync(join(state, 'skills/.skill-lock.json'), '{ not json')
    process.env.XDG_STATE_HOME = state
    try {
      const data = expectSuccess(await get<{ skills: Skill[] }>('/api/skills'))
      const store = data.skills.filter(s => s.location === 'global-agents')
      expect(store.length).toBeGreaterThan(0)
      expect(store.every(s => s.managed)).toBe(true)
      expectError(await put('/api/skills/global-agents/local-notes/file', { path: 'SKILL.md', content: 'x' }), 409)
      expectError(await del('/api/skills/global-agents/local-notes'), 409)
    } finally {
      delete process.env.XDG_STATE_HOME
      rmSync(state, { recursive: true, force: true })
    }
  })
})

describe('CLAUDE_CONFIG_DIR', () => {
  test('deleting a global skill removes its link from the configured Claude dir', async () => {
    const claudeConfig = mkdtempSync(join(tmpdir(), 'bkd-skills-claude-del-'))
    process.env.CLAUDE_CONFIG_DIR = claudeConfig
    try {
      expectSuccess(await post('/api/skills', { scope: 'global', name: 'linked-elsewhere', description: 'x' }))
      expect(lstatSync(join(claudeConfig, 'skills/linked-elsewhere')).isSymbolicLink()).toBe(true)
      expectSuccess(await del('/api/skills/global-agents/linked-elsewhere'))
      expect(existsSync(join(claudeConfig, 'skills/linked-elsewhere'))).toBe(false)
      expect(() => lstatSync(join(claudeConfig, 'skills/linked-elsewhere'))).toThrow()
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR
      rmSync(claudeConfig, { recursive: true, force: true })
    }
  })
})

describe('project store symlinks', () => {
  test('ignores a project skill that links outside the project', async () => {
    // A checkout could link .agents/skills/<name> to any directory with a SKILL.md
    const outside = mkdtempSync(join(tmpdir(), 'bkd-skills-outside-'))
    writeSkill(outside, 'escape', 'Outside the project')
    symlinkSync(join(outside, 'escape'), join(projectDir, '.agents/skills/escape'))
    try {
      const data = expectSuccess(await get<{ skills: Skill[] }>(`/api/skills?projectId=${projectId}`))
      expect(data.skills.find(s => s.name === 'escape')).toBeUndefined()
      // Links inside the project (.claude/skills -> ../../.agents/skills) still count
      expect(data.skills.find(s => s.name === 'proj-new')?.agents.sort()).toEqual(['claude-code', 'codex'])
      expectError(await get(`/api/skills/project-agents/escape/file?path=SKILL.md&projectId=${projectId}`), 404)
      expectError(await put('/api/skills/project-agents/escape/file', { path: 'SKILL.md', content: 'x', projectId }), 404)
      expect(readFileSync(join(outside, 'escape/SKILL.md'), 'utf8')).toContain('Outside the project')
    } finally {
      rmSync(join(projectDir, '.agents/skills/escape'), { force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('symlinked Claude stores', () => {
  test('a Claude dir linked to the agents store adds no editable aliases and still accepts new skills', async () => {
    // Some setups link ~/.claude/skills to ~/.agents/skills wholesale
    const claudeConfig = mkdtempSync(join(tmpdir(), 'bkd-skills-claude-alias-'))
    symlinkSync(join(home, '.agents/skills'), join(claudeConfig, 'skills'))
    process.env.CLAUDE_CONFIG_DIR = claudeConfig
    try {
      const data = expectSuccess(await get<{ skills: Skill[] }>('/api/skills'))
      expect(data.skills.filter(s => s.location === 'global-claude')).toEqual([])
      const pma = data.skills.find(s => s.name === 'pma')!
      expect(pma).toMatchObject({ location: 'global-agents', managed: true })
      expect(pma.agents.sort()).toEqual(['claude-code', 'codex'])
      expectSuccess(await post('/api/skills', { scope: 'global', name: 'via-alias', description: 'x' }))
      expect(lstatSync(join(home, '.agents/skills/via-alias')).isDirectory()).toBe(true)
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR
      rmSync(join(home, '.agents/skills/via-alias'), { recursive: true, force: true })
      rmSync(claudeConfig, { recursive: true, force: true })
    }
  })

  test('ignores project Claude skills reached through a link outside the project', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'bkd-skills-claude-outside-'))
    writeSkill(outside, 'external', 'Outside the project')
    const project = mkdtempSync(join(tmpdir(), 'bkd-skills-claude-proj-'))
    mkdirSync(join(project, '.claude'), { recursive: true })
    symlinkSync(outside, join(project, '.claude/skills'))
    const created = expectSuccess(await post<{ id: string }>('/api/projects', { name: 'Linked Claude', directory: project }))
    try {
      const data = expectSuccess(await get<{ skills: Skill[] }>(`/api/skills?projectId=${created.id}`))
      expect(data.skills.find(s => s.name === 'external')).toBeUndefined()
      expectError(await put('/api/skills/project-claude/external/file', { path: 'SKILL.md', content: 'x', projectId: created.id }), 404)
    } finally {
      rmSync(project, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('copy and create edge cases', () => {
  test('copying keeps an inner symlink a link instead of pulling in what it points to', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'bkd-skills-secret-'))
    writeFileSync(join(outside, 'secret.txt'), 'host file')
    writeSkill(join(home, '.agents/skills'), 'has-link', 'Links out')
    symlinkSync(join(outside, 'secret.txt'), join(home, '.agents/skills/has-link/secret.txt'))
    try {
      expectSuccess(await post('/api/skills/global-agents/has-link/copy', { name: 'has-link-copy' }))
      expect(lstatSync(join(home, '.agents/skills/has-link-copy/secret.txt')).isSymbolicLink()).toBe(true)
      expectError(await get('/api/skills/global-agents/has-link-copy/file?path=secret.txt'), 400)
    } finally {
      for (const n of ['has-link', 'has-link-copy']) rmSync(join(home, '.agents/skills', n), { recursive: true, force: true })
      rmSync(join(home, '.claude/skills/has-link-copy'), { force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('a failed create leaves nothing behind, so the name can be used again', async () => {
    // The Claude dir path is a file: linking fails after the skill directory was written
    const claudeConfig = mkdtempSync(join(tmpdir(), 'bkd-skills-claude-file-'))
    writeFileSync(join(claudeConfig, 'skills'), 'not a directory')
    process.env.CLAUDE_CONFIG_DIR = claudeConfig
    try {
      const res = await post('/api/skills', { scope: 'global', name: 'half-made', description: 'x' })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(existsSync(join(home, '.agents/skills/half-made'))).toBe(false)
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR
      rmSync(join(home, '.agents/skills/half-made'), { recursive: true, force: true })
      rmSync(claudeConfig, { recursive: true, force: true })
    }
  })
})

describe('project stores linked outside the project', () => {
  test('refuse project-scoped writes instead of following the link', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'bkd-skills-store-outside-'))
    for (const store of ['.agents', '.claude/skills']) {
      const project = mkdtempSync(join(tmpdir(), 'bkd-skills-store-proj-'))
      mkdirSync(dirname(join(project, store)), { recursive: true })
      symlinkSync(outside, join(project, store))
      const created = expectSuccess(await post<{ id: string }>('/api/projects', { name: `Linked ${store}`, directory: project }))
      try {
        expectError(await post('/api/skills', { scope: 'project', projectId: created.id, name: 'leak', description: 'x' }), 400)
      } finally {
        rmSync(project, { recursive: true, force: true })
      }
    }
    try {
      expect(readdirSync(outside)).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('create validation', () => {
  test('rejects a description that is only whitespace', async () => {
    expectError(await post('/api/skills', { scope: 'global', name: 'blank-desc', description: '   ' }), 400)
    expect(existsSync(join(home, '.agents/skills/blank-desc'))).toBe(false)
  })

  test('reports the ref an installed skill came from', async () => {
    const state = mkdtempSync(join(tmpdir(), 'bkd-skills-ref-'))
    mkdirSync(join(state, 'skills'), { recursive: true })
    writeFileSync(join(state, 'skills/.skill-lock.json'), JSON.stringify({ version: 3, skills: { pma: { source: 'zzci/skills', ref: 'v1' } } }))
    process.env.XDG_STATE_HOME = state
    try {
      const data = expectSuccess(await get<{ skills: Skill[] }>('/api/skills'))
      expect(data.skills.find(s => s.name === 'pma')?.sourceRef).toBe('v1')
      expect(data.skills.find(s => s.name === 'claude-only')?.sourceRef).toBeNull()
    } finally {
      delete process.env.XDG_STATE_HOME
      rmSync(state, { recursive: true, force: true })
    }
  })
})

describe('lock keys the CLI sanitized into folder names', () => {
  test('a skill installed as "Local Notes" in local-notes/ is managed, with its source', async () => {
    // skills@1.7.4 names the folder sanitizeName(name) but keys the lock by the original name
    const state = mkdtempSync(join(tmpdir(), 'bkd-skills-cased-'))
    mkdirSync(join(state, 'skills'), { recursive: true })
    writeFileSync(join(state, 'skills/.skill-lock.json'), JSON.stringify({ version: 3, skills: { 'Local Notes': { source: 'me/notes' } } }))
    process.env.XDG_STATE_HOME = state
    try {
      const data = expectSuccess(await get<{ skills: Skill[] }>('/api/skills'))
      expect(data.skills.find(s => s.name === 'local-notes')).toMatchObject({ managed: true, source: 'me/notes' })
      expectError(await put('/api/skills/global-agents/local-notes/file', { path: 'SKILL.md', content: 'x' }), 409)
    } finally {
      delete process.env.XDG_STATE_HOME
      rmSync(state, { recursive: true, force: true })
    }
  })
})
