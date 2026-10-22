import type { Dirent } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import type { SkillAgent, SkillFileEntry, SkillInfo, SkillLocation } from '@bkd/shared'
import { DATA_DIR } from '@/root'

/*
 * Skills live on disk in the layout the `skills` CLI (vercel-labs/skills) uses:
 * the shared store `.agents/skills/<name>/` (read by Codex; entries the CLI
 * installed are tracked in `.agents/.skill-lock.json`) and `.claude/skills/`
 * (read by Claude Code), which holds symlinks into the shared store plus any
 * real skill directories. The same pair exists per project. A skill is a
 * directory with a SKILL.md.
 */

export class SkillError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message)
  }
}

const NAME_RE = /^[a-z0-9][\w.-]{0,63}$/i
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES = 500
const SKIP_DIRS = new Set(['.git', 'node_modules'])

interface Roots {
  agents: string
  claude: string
  lockFile: string
}

function home(): string {
  return process.env.HOME || homedir()
}

function globalRoots(): Roots {
  return {
    agents: join(home(), '.agents/skills'),
    claude: join(home(), '.claude/skills'),
    lockFile: join(home(), '.agents/.skill-lock.json'),
  }
}

function projectRoots(projectDir: string): Roots {
  return {
    agents: join(projectDir, '.agents/skills'),
    claude: join(projectDir, '.claude/skills'),
    lockFile: join(projectDir, 'skills-lock.json'),
  }
}

function trashDir(): string {
  return process.env.BKD_SKILLS_TRASH_DIR || join(DATA_DIR, 'trash/skills')
}

export function assertSkillName(name: string): void {
  if (!NAME_RE.test(name) || name.includes('..')) throw new SkillError('Invalid skill name', 400)
}

/** `name` / `description` from the SKILL.md frontmatter (plain, quoted or folded scalars). */
export function parseFrontmatter(markdown: string): { name?: string, description?: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const lines = match[1]!.split(/\r?\n/)
  const out: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i]!.match(/^(name|description):(.*)$/)
    if (!field) continue
    let value = field[2]!.trim()
    if (/^[>|][+-]?$/.test(value)) {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) parts.push(lines[++i]!.trim())
      value = parts.join(' ')
    }
    out[field[1]!] = value.replace(/^(["'])(.*)\1$/, '$2')
  }
  return out
}

interface LockEntry { source?: string, sourceUrl?: string, updatedAt?: string }

async function readLock(lockFile: string): Promise<Record<string, LockEntry>> {
  try {
    const parsed = JSON.parse(await readFile(lockFile, 'utf8')) as { skills?: Record<string, LockEntry> }
    return parsed.skills ?? {}
  } catch {
    return {}
  }
}

async function readEntries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function readDescription(dir: string): Promise<{ name?: string, description?: string } | null> {
  try {
    return parseFrontmatter(await readFile(join(dir, 'SKILL.md'), 'utf8'))
  } catch {
    return null
  }
}

/** Names in `.claude/skills` that are symlinks resolving into the agents store. */
async function claudeLinks(roots: Roots): Promise<Set<string>> {
  const linked = new Set<string>()
  const agentsReal = await realpath(roots.agents).catch(() => roots.agents)
  for (const entry of await readEntries(roots.claude)) {
    if (!entry.isSymbolicLink()) continue
    const target = await realpath(join(roots.claude, entry.name)).catch(() => null)
    if (target && dirname(target) === agentsReal) linked.add(basename(target))
  }
  return linked
}

async function scan(roots: Roots, scope: 'global' | 'project'): Promise<SkillInfo[]> {
  const lock = await readLock(roots.lockFile)
  const linked = await claudeLinks(roots)
  const skills: SkillInfo[] = []

  for (const entry of await readEntries(roots.agents)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dir = join(roots.agents, entry.name)
    const meta = await readDescription(dir)
    if (!meta) continue
    const locked = lock[entry.name]
    const agents: SkillAgent[] = ['codex']
    if (linked.has(entry.name)) agents.unshift('claude-code')
    skills.push({
      location: scope === 'global' ? 'global-agents' : 'project-agents',
      scope,
      name: entry.name,
      description: meta.description ?? '',
      path: dir,
      managed: !!locked,
      source: locked?.source ?? null,
      sourceUrl: locked?.sourceUrl ?? null,
      updatedAt: locked?.updatedAt ?? null,
      agents,
    })
  }

  // Real directories in .claude/skills are Claude Code only; symlinks were counted above.
  for (const entry of await readEntries(roots.claude)) {
    if (!entry.isDirectory()) continue
    const dir = join(roots.claude, entry.name)
    const meta = await readDescription(dir)
    if (!meta) continue
    skills.push({
      location: scope === 'global' ? 'global-claude' : 'project-claude',
      scope,
      name: entry.name,
      description: meta.description ?? '',
      path: dir,
      managed: false,
      source: null,
      sourceUrl: null,
      updatedAt: null,
      agents: ['claude-code'],
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listSkills(projectDir?: string | null): Promise<SkillInfo[]> {
  const global = await scan(globalRoots(), 'global')
  return projectDir ? [...global, ...await scan(projectRoots(projectDir), 'project')] : global
}

function rootsFor(location: SkillLocation, projectDir?: string | null): { roots: Roots, base: string } {
  if (location.startsWith('project')) {
    if (!projectDir) throw new SkillError('Project has no directory', 400)
    const roots = projectRoots(projectDir)
    return { roots, base: location === 'project-agents' ? roots.agents : roots.claude }
  }
  const roots = globalRoots()
  return { roots, base: location === 'global-agents' ? roots.agents : roots.claude }
}

export async function getSkill(location: SkillLocation, name: string, projectDir?: string | null): Promise<SkillInfo> {
  assertSkillName(name)
  const { base } = rootsFor(location, projectDir)
  const skills = await listSkills(location.startsWith('project') ? projectDir : null)
  const skill = skills.find(s => s.location === location && s.name === name && s.path === join(base, name))
  if (!skill) throw new SkillError('Skill not found', 404)
  return skill
}

/** Resolve a file path inside a skill directory, following symlinks, or throw. */
async function resolveInside(skillDir: string, relPath: string): Promise<string> {
  if (!relPath || relPath.includes('\0')) throw new SkillError('Invalid path', 400)
  const root = await realpath(skillDir)
  const target = resolve(root, relPath)
  if (target !== root && !target.startsWith(root + sep)) throw new SkillError('Path is outside the skill', 400)
  // An existing entry (or its nearest existing parent) must not lead outside via a symlink.
  let probe = target
  while (!(await exists(probe))) probe = dirname(probe)
  const real = await realpath(probe)
  if (real !== root && !real.startsWith(root + sep)) throw new SkillError('Path is outside the skill', 400)
  return target
}

export async function listSkillFiles(skill: SkillInfo): Promise<SkillFileEntry[]> {
  const root = await realpath(skill.path)
  const out: SkillFileEntry[] = []
  async function walk(dir: string): Promise<void> {
    for (const entry of (await readEntries(dir)).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return
      const full = join(dir, entry.name)
      const rel = relative(root, full)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        out.push({ path: rel, type: 'dir', size: 0 })
        await walk(full)
      } else if (entry.isFile()) {
        out.push({ path: rel, type: 'file', size: (await stat(full)).size })
      }
    }
  }
  await walk(root)
  return out
}

export async function readSkillFile(skill: SkillInfo, relPath: string): Promise<{ path: string, content: string, binary: boolean }> {
  const target = await resolveInside(skill.path, relPath)
  const info = await stat(target).catch(() => null)
  if (!info?.isFile()) throw new SkillError('File not found', 404)
  if (info.size > MAX_FILE_BYTES) throw new SkillError('File is too large to open', 400)
  const buffer = await readFile(target)
  const binary = buffer.includes(0)
  return { path: relPath, content: binary ? '' : buffer.toString('utf8'), binary }
}

function assertEditable(skill: SkillInfo): void {
  if (skill.managed) {
    throw new SkillError('Installed skills are read-only: `skills update` would overwrite local changes. Copy it to a local skill first.', 409)
  }
}

export async function writeSkillFile(skill: SkillInfo, relPath: string, content: string): Promise<void> {
  assertEditable(skill)
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new SkillError('File is too large', 400)
  const target = await resolveInside(skill.path, relPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
}

/** New skills go to the agents store (Codex) and get a relative link in .claude/skills (Claude Code). */
async function placeNewSkill(roots: Roots, name: string, fill: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(roots.agents, name)
  const link = join(roots.claude, name)
  if (await exists(dir) || await exists(link)) throw new SkillError('A skill with this name already exists', 409)
  await mkdir(roots.agents, { recursive: true })
  await fill(dir)
  await mkdir(roots.claude, { recursive: true })
  await symlink(relative(roots.claude, dir), link)
}

export async function createSkill(scope: 'global' | 'project', name: string, description: string, projectDir?: string | null): Promise<SkillInfo> {
  assertSkillName(name)
  const location: SkillLocation = scope === 'global' ? 'global-agents' : 'project-agents'
  const { roots } = rootsFor(location, projectDir)
  const oneLine = description.replace(/\s+/g, ' ').trim()
  await placeNewSkill(roots, name, async (dir) => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${JSON.stringify(oneLine)}\n---\n\n# ${name}\n\n${oneLine}\n`, 'utf8')
  })
  return getSkill(location, name, projectDir)
}

export async function copySkill(skill: SkillInfo, newName: string, projectDir?: string | null): Promise<SkillInfo> {
  assertSkillName(newName)
  const location: SkillLocation = skill.scope === 'global' ? 'global-agents' : 'project-agents'
  const { roots } = rootsFor(location, projectDir)
  await placeNewSkill(roots, newName, async (dir) => {
    await cp(await realpath(skill.path), dir, { recursive: true, dereference: true })
    const skillMd = join(dir, 'SKILL.md')
    const text = await readFile(skillMd, 'utf8')
    await writeFile(skillMd, text.replace(/^(---\r?\n[\s\S]*?)^name:.*$/m, `$1name: ${newName}`), 'utf8')
  })
  return getSkill(location, newName, projectDir)
}

/** Move a local skill to the trash (recoverable) and drop the .claude link pointing at it. */
export async function deleteSkill(skill: SkillInfo): Promise<void> {
  assertEditable(skill)
  const trash = join(trashDir(), `${new Date().toISOString().replace(/[:.]/g, '-')}-${skill.location}-${skill.name}`)
  await mkdir(dirname(trash), { recursive: true })
  try {
    await rename(skill.path, trash)
  } catch {
    // Different filesystem: copy, then remove
    await cp(skill.path, trash, { recursive: true })
    await rm(skill.path, { recursive: true, force: true })
  }
  if (skill.location.endsWith('agents')) {
    // <base>/.agents/skills/<name> -> <base>/.claude/skills
    const claudeDir = join(dirname(dirname(dirname(skill.path))), '.claude/skills')
    const link = join(claudeDir, skill.name)
    const target = await readlink(link).catch(() => null)
    if (target && resolve(claudeDir, target) === skill.path) await rm(link, { force: true })
  }
}
