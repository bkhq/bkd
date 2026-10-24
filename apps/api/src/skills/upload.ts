import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, sep } from 'node:path'
import type { SkillInfo, SkillUploadResult } from '@bkd/shared'
import { unzipSync } from 'fflate'
import { assertProjectScope, getSkill, globalRoots, parseFrontmatter, placeNewSkill, projectRoots, SkillError } from './service'

/*
 * Uploaded skills: a SKILL.md (.md) or an archive (.zip / .skill) holding a
 * SKILL.md at its root or skill folders one level down. They become local
 * skills, placed like created ones; existing names are never overwritten.
 */

export const MAX_SKILL_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024
const MAX_ENTRIES = 1000
const NAME_RE = /^[a-z0-9][\w.-]{0,63}$/i

/** Archive entries as path → bytes, checked before anything is inflated. */
function unpack(data: Uint8Array): Map<string, Uint8Array> {
  let total = 0
  let count = 0
  let problem: string | null = null
  const files = unzipSync(data, {
    filter: (entry) => {
      if (problem) return false
      const path = entry.name.replace(/\\/g, '/')
      if (path.endsWith('/')) return false
      if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..') || path.includes('\0')) {
        problem = `Unsafe path in archive: ${entry.name}`
        return false
      }
      // macOS resource forks carry no skill content
      if (path.startsWith('__MACOSX/') || basename(path) === '.DS_Store') return false
      count += 1
      total += entry.originalSize
      if (count > MAX_ENTRIES) problem = `Archive has more than ${MAX_ENTRIES} files`
      else if (total > MAX_UNPACKED_BYTES) problem = `Archive unpacks to more than ${MAX_UNPACKED_BYTES / 1024 / 1024} MB`
      return !problem
    },
  })
  if (problem) throw new SkillError(problem, 400)
  return new Map(Object.entries(files).map(([k, v]) => [k.replace(/\\/g, '/'), v]))
}

/** Skill roots in an archive: '' when SKILL.md is at the root, otherwise top-level folders holding one. */
function skillFolders(files: Map<string, Uint8Array>): string[] {
  if (files.has('SKILL.md')) return ['']
  return [...files.keys()]
    .filter(p => /^[^/]+\/SKILL\.md$/.test(p))
    .map(p => p.split('/')[0]!)
    .sort()
}

/** The frontmatter name, or null unless SKILL.md has the name and description the skills CLI requires. */
function pickName(skillMd: string): string | null {
  const meta = parseFrontmatter(skillMd)
  const name = meta.name?.trim()
  if (!name || !NAME_RE.test(name) || !meta.description?.trim()) return null
  return name
}

export async function uploadSkills(
  file: { originalName: string, absolutePath: string },
  scope: 'global' | 'project',
  projectDir?: string | null,
): Promise<SkillUploadResult> {
  await assertProjectScope(scope, projectDir)
  if (scope === 'project' && !projectDir) throw new SkillError('Project has no directory', 400)
  const roots = scope === 'global' ? globalRoots() : projectRoots(projectDir!)
  const location = scope === 'global' ? 'global-agents' : 'project-agents'
  const ext = extname(file.originalName).toLowerCase()
  const data = new Uint8Array(await readFile(file.absolutePath))

  let entries: { folder: string, files: Map<string, Uint8Array> }[]
  if (ext === '.md') {
    entries = [{ folder: '', files: new Map([['SKILL.md', data]]) }]
  } else if (ext === '.zip' || ext === '.skill') {
    let files: Map<string, Uint8Array>
    try {
      files = unpack(data)
    } catch (err) {
      if (err instanceof SkillError) throw err
      throw new SkillError('Not a valid zip archive', 400)
    }
    const folders = skillFolders(files)
    if (!folders.length) throw new SkillError('No SKILL.md found at the archive root or in a top-level folder', 400)
    entries = folders.map((folder) => {
      const prefix = folder ? `${folder}/` : ''
      const own = new Map([...files].filter(([p]) => p.startsWith(prefix)).map(([p, v]) => [p.slice(prefix.length), v]))
      return { folder, files: own }
    })
  } else {
    throw new SkillError('Upload a .zip, .skill or .md file', 400)
  }

  const result: SkillUploadResult = { created: [], conflicts: [], skipped: [] }
  for (const entry of entries) {
    const skillMd = new TextDecoder().decode(entry.files.get('SKILL.md'))
    const name = pickName(skillMd)
    if (!name) {
      result.skipped.push({ path: entry.folder || file.originalName, reason: 'SKILL.md needs a valid name and a description in its frontmatter' })
      continue
    }
    try {
      await placeNewSkill(roots, name, async (dir) => {
        await mkdir(dir, { recursive: true })
        for (const [rel, bytes] of entry.files) {
          const target = join(dir, normalize(rel))
          if (!target.startsWith(dir + sep)) throw new SkillError(`Unsafe path in archive: ${rel}`, 400)
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, bytes)
        }
      })
      result.created.push(await getSkill(location, name, projectDir) as SkillInfo)
    } catch (err) {
      if (err instanceof SkillError && err.status === 409) result.conflicts.push(name)
      else throw err
    }
  }
  return result
}
