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

export interface Roots {
  agents: string
  claude: string
  lockFile: string
}

function home(): string {
  return process.env.HOME || homedir()
}

/** Resolved as skills@1.7.4 does: its global lock follows XDG_STATE_HOME, its Claude dir CLAUDE_CONFIG_DIR. */
export function globalRoots(): Roots {
  const stateHome = process.env.XDG_STATE_HOME
  const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home(), '.claude')
  return {
    agents: join(home(), '.agents/skills'),
    claude: join(claudeHome, 'skills'),
    lockFile: stateHome ? join(stateHome, 'skills/.skill-lock.json') : join(home(), '.agents/.skill-lock.json'),
  }
}

export function projectRoots(projectDir: string): Roots {
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

export interface LockEntry {
  source?: string
  sourceType?: string
  sourceUrl?: string
  /** Path of SKILL.md inside the source repository */
  skillPath?: string
  /** Git tree hash of the skill folder when installed */
  skillFolderHash?: string
  /** Branch or tag it was installed from; absent for the default branch */
  ref?: string
  updatedAt?: string
}

/**
 * Entries of a lock file: `{}` when there is none, `null` when one exists but
 * cannot be read or parsed, so callers can fail closed.
 */
export async function readLock(lockFile: string): Promise<Record<string, LockEntry> | null> {
  let text: string
  try {
    text = await readFile(lockFile, 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? {} : null
  }
  try {
    const parsed = JSON.parse(text) as { skills?: Record<string, LockEntry> }
    return parsed.skills ?? {}
  } catch {
    return null
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
/** `.claude/skills` linked wholesale to `.agents/skills`: one store seen by both engines. */
async function claudeIsAgentsStore(roots: Roots): Promise<boolean> {
  const [claude, agents] = await Promise.all([realpath(roots.claude).catch(() => null), realpath(roots.agents).catch(() => null)])
  return !!claude && claude === agents
}

async function claudeLinks(roots: Roots): Promise<Set<string>> {
  const linked = new Set<string>()
  if (await claudeIsAgentsStore(roots)) {
    // Claude Code reads the whole store
    for (const entry of await readEntries(roots.agents)) linked.add(entry.name)
    return linked
  }
  const agentsReal = await realpath(roots.agents).catch(() => roots.agents)
  for (const entry of await readEntries(roots.claude)) {
    if (!entry.isSymbolicLink()) continue
    const target = await realpath(join(roots.claude, entry.name)).catch(() => null)
    if (target && dirname(target) === agentsReal) linked.add(basename(target))
  }
  return linked
}

/** Whether `dir` resolves inside `root` (both realpath'd), so a symlink cannot lead elsewhere. */
async function resolvesInside(dir: string, root: string): Promise<boolean> {
  const [real, base] = await Promise.all([realpath(dir).catch(() => null), realpath(root).catch(() => resolve(root))])
  return !!real && real.startsWith(base + sep)
}

/** `confine`: a project directory every skill must resolve inside; a checkout may link anywhere. */
async function scan(roots: Roots, scope: 'global' | 'project', confine?: string): Promise<SkillInfo[]> {
  const lock = await readLock(roots.lockFile)
  const linked = await claudeLinks(roots)
  const skills: SkillInfo[] = []

  for (const entry of await readEntries(roots.agents)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dir = join(roots.agents, entry.name)
    if (confine && !(await resolvesInside(dir, confine))) continue
    const meta = await readDescription(dir)
    if (!meta) continue
    const locked = lock?.[entry.name]
    const agents: SkillAgent[] = ['codex']
    if (linked.has(entry.name)) agents.unshift('claude-code')
    skills.push({
      location: scope === 'global' ? 'global-agents' : 'project-agents',
      scope,
      name: entry.name,
      description: meta.description ?? '',
      path: dir,
      // An unreadable lock may still own any of these: keep them all read-only
      managed: lock === null || !!locked,
      source: locked?.source ?? null,
      sourceUrl: locked?.sourceUrl ?? null,
      sourcePath: locked?.skillPath ? (dirname(locked.skillPath) === '.' ? '' : dirname(locked.skillPath)) : null,
      sourceRef: locked?.ref || null,
      updatedAt: locked?.updatedAt ?? null,
      agents,
    })
  }

  // Real directories in .claude/skills are Claude Code only; symlinks were counted above.
  // A Claude dir that is the agents store would list every store skill again, editable.
  const claudeEntries = await claudeIsAgentsStore(roots) ? [] : await readEntries(roots.claude)
  for (const entry of claudeEntries) {
    if (!entry.isDirectory()) continue
    const dir = join(roots.claude, entry.name)
    if (confine && !(await resolvesInside(dir, confine))) continue
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
      sourcePath: null,
      sourceRef: null,
      updatedAt: null,
      agents: ['claude-code'],
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * A project rooted at HOME has the global stores as its project stores (and the
 * global lock is not a project lock), so it has no project skills of its own:
 * listing them would show installed skills again as editable.
 */
export async function isHomeDir(dir: string): Promise<boolean> {
  const [a, b] = await Promise.all([realpath(dir).catch(() => resolve(dir)), realpath(home()).catch(() => resolve(home()))])
  return a === b
}

export async function listSkills(projectDir?: string | null): Promise<SkillInfo[]> {
  const global = await scan(globalRoots(), 'global')
  if (!projectDir || await isHomeDir(projectDir)) return global
  return [...global, ...await scan(projectRoots(projectDir), 'project', projectDir)]
}

export async function assertProjectScope(scope: 'global' | 'project', projectDir?: string | null): Promise<void> {
  if (scope !== 'project' || !projectDir) return
  if (await isHomeDir(projectDir)) {
    throw new SkillError('This project\'s directory is your home directory, so its skills are the global ones: use the global scope', 400)
  }
  // A checkout may link .agents or .claude/skills anywhere; writes would follow the link
  const base = await realpath(projectDir).catch(() => resolve(projectDir))
  const roots = projectRoots(projectDir)
  for (const store of [roots.agents, roots.claude]) {
    let probe = store
    while (!(await exists(probe))) probe = dirname(probe)
    const real = await realpath(probe)
    if (real !== base && !real.startsWith(base + sep)) {
      throw new SkillError('This project\'s skill directory links outside the project', 400)
    }
  }
  // The CLI writes skills-lock.json in place, following a symlink (even a dangling one)
  if ((await lstat(roots.lockFile).catch(() => null))?.isSymbolicLink()) {
    const real = await realpath(roots.lockFile).catch(() => null)
    if (!real || !real.startsWith(base + sep)) {
      throw new SkillError('This project\'s skills-lock.json links outside the project', 400)
    }
  }
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
export async function placeNewSkill(roots: Roots, name: string, fill: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(roots.agents, name)
  const link = join(roots.claude, name)
  if (await exists(dir) || await exists(link)) throw new SkillError('A skill with this name already exists', 409)
  await mkdir(roots.agents, { recursive: true })
  try {
    await fill(dir)
    // When .claude/skills is the agents store, Claude Code already sees the new directory
    if (!(await claudeIsAgentsStore(roots))) {
      await mkdir(roots.claude, { recursive: true })
      await symlink(relative(roots.claude, dir), link)
    }
  } catch (err) {
    // A half-made skill would be listed and block the name on every retry
    await rm(dir, { recursive: true, force: true })
    throw err
  }
}

export async function createSkill(scope: 'global' | 'project', name: string, description: string, projectDir?: string | null): Promise<SkillInfo> {
  assertSkillName(name)
  await assertProjectScope(scope, projectDir)
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
  await assertProjectScope(skill.scope, projectDir)
  const location: SkillLocation = skill.scope === 'global' ? 'global-agents' : 'project-agents'
  const { roots } = rootsFor(location, projectDir)
  await placeNewSkill(roots, newName, async (dir) => {
    // Inner symlinks stay links: following them would copy files from outside the skill
    await cp(await realpath(skill.path), dir, { recursive: true, verbatimSymlinks: true })
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
    // The link lives in the Claude dir that creation used (CLAUDE_CONFIG_DIR for global skills)
    const claudeDir = skill.scope === 'global' ? globalRoots().claude : projectRoots(dirname(dirname(dirname(skill.path)))).claude
    const link = join(claudeDir, skill.name)
    const target = await readlink(link).catch(() => null)
    if (target && resolve(claudeDir, target) === skill.path) await rm(link, { force: true })
  }
}
