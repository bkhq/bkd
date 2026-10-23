import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import app from '@/app'
import type { GithubTreeFetcher } from '@/skills/updates'
import { resetSkillUpdateCache, setGithubTreeFetcher } from '@/skills/updates'
import { expectSuccess, get } from './helpers'
/**
 * Update status of installed skills (GitHub tree hashes vs the lock file, with a
 * fake GitHub) and uploading skills as .md / .zip / .skill files.
 */
import './setup'

interface UpdateStatus { location: string, name: string, status: 'latest' | 'update' | 'removed' | 'unknown' }
interface UploadResult { created: { name: string, location: string }[], conflicts: string[], skipped: { path: string, reason: string }[] }

let home: string
const originalHome = process.env.HOME
let fetches: string[] = []
let trees: Record<string, { sha: string, tree: { path: string, type: string, sha: string }[] } | null> = {}

const fakeFetcher: GithubTreeFetcher = async (source, ref) => {
  const key = ref ? `${source}@${ref}` : source
  fetches.push(key)
  const tree = trees[key]
  if (!tree) throw new Error('not found')
  return tree
}

function writeSkill(dir: string, name: string) {
  mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`)
}

function upload(files: { name: string, data: Uint8Array | string }[], fields: Record<string, string> = { scope: 'global' }) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  for (const f of files) fd.append('files', new File([typeof f.data === 'string' ? f.data : new Uint8Array(f.data)], f.name))
  return app.request('http://localhost/api/skills/upload', { method: 'POST', body: fd })
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'bkd-skills-upd-home-'))
  process.env.HOME = home
  const store = join(home, '.agents/skills')
  for (const n of ['fresh', 'stale', 'gone', 'other', 'pinned']) writeSkill(store, n)
  writeSkill(store, 'local-only')
  writeFileSync(join(home, '.agents/.skill-lock.json'), JSON.stringify({
    version: 3,
    skills: {
      fresh: { source: 'a/repo', sourceType: 'github', skillPath: 'skills/fresh/SKILL.md', skillFolderHash: 'h-fresh' },
      stale: { source: 'a/repo', sourceType: 'github', skillPath: 'skills/stale/SKILL.md', skillFolderHash: 'h-old' },
      gone: { source: 'a/repo', sourceType: 'github', skillPath: 'skills/gone/SKILL.md', skillFolderHash: 'h-gone' },
      other: { source: 'b/missing', sourceType: 'github', skillPath: 'SKILL.md', skillFolderHash: 'h-x' },
      // Installed from a tag: compared with that ref, not the default branch
      pinned: { source: 'a/repo', sourceType: 'github', ref: 'v1', skillPath: 'skills/pinned/SKILL.md', skillFolderHash: 'h-pin' },
    },
  }))
  setGithubTreeFetcher(fakeFetcher)
})

afterEach(() => {
  fetches = []
  resetSkillUpdateCache()
})

afterAll(() => {
  setGithubTreeFetcher(null)
  process.env.HOME = originalHome
  rmSync(home, { recursive: true, force: true })
})

describe('GET /api/skills/updates', () => {
  test('compares each installed skill with its folder hash on GitHub, one request per source', async () => {
    trees = {
      'a/repo': { sha: 'root', tree: [
        { path: 'skills/fresh', type: 'tree', sha: 'h-fresh' },
        { path: 'skills/stale', type: 'tree', sha: 'h-new' },
      ] },
      'a/repo@v1': { sha: 'root-v1', tree: [{ path: 'skills/pinned', type: 'tree', sha: 'h-pin' }] },
      'b/missing': null,
    }
    const data = expectSuccess(await get<{ updates: UpdateStatus[] }>('/api/skills/updates'))
    const byName = Object.fromEntries(data.updates.map(u => [u.name, u.status]))
    expect(byName).toEqual({ fresh: 'latest', stale: 'update', gone: 'removed', other: 'unknown', pinned: 'latest' })
    expect(fetches.sort()).toEqual(['a/repo', 'a/repo@v1', 'b/missing'])
  })

  test('caches GitHub answers between requests', async () => {
    trees = { 'a/repo': { sha: 'root', tree: [] }, 'a/repo@v1': { sha: 'root-v1', tree: [] }, 'b/missing': { sha: 'h-x', tree: [] } }
    await get('/api/skills/updates')
    await get('/api/skills/updates')
    expect(fetches.length).toBe(3)
    // A root-level skill compares against the repository root tree
    const data = expectSuccess(await get<{ updates: UpdateStatus[] }>('/api/skills/updates'))
    expect(data.updates.find(u => u.name === 'other')?.status).toBe('latest')
  })
})

describe('POST /api/skills/upload', () => {
  test('a .md file becomes a skill named by its frontmatter, linked for Claude Code', async () => {
    const res = await upload([{ name: 'whatever.md', data: '---\nname: md-skill\ndescription: From md\n---\n\nBody\n' }])
    expect(res.status).toBe(200)
    const data = ((await res.json()) as { data: UploadResult }).data
    expect(data.created.map(c => c.name)).toEqual(['md-skill'])
    expect(readFileSync(join(home, '.agents/skills/md-skill/SKILL.md'), 'utf8')).toContain('Body')
    expect(lstatSync(join(home, '.claude/skills/md-skill')).isSymbolicLink()).toBe(true)
  })

  test('a .zip with skill folders installs each folder, keeping their files', async () => {
    const zip = zipSync({
      'zip-one/SKILL.md': strToU8('---\nname: zip-one\ndescription: One\n---\n'),
      'zip-one/references/a.md': strToU8('ref'),
      'zip-two/SKILL.md': strToU8('---\nname: zip-two\ndescription: Two\n---\n'),
      'README.md': strToU8('not a skill'),
    })
    const res = await upload([{ name: 'bundle.zip', data: zip }])
    const data = ((await res.json()) as { data: UploadResult }).data
    expect(data.created.map(c => c.name).sort()).toEqual(['zip-one', 'zip-two'])
    expect(readFileSync(join(home, '.agents/skills/zip-one/references/a.md'), 'utf8')).toBe('ref')
  })

  test('a .skill archive with SKILL.md at its root is one skill', async () => {
    const zip = zipSync({ 'SKILL.md': strToU8('---\nname: packed\ndescription: P\n---\n'), 'scripts/run.sh': strToU8('echo hi') })
    const data = ((await (await upload([{ name: 'packed.skill', data: zip }])).json()) as { data: UploadResult }).data
    expect(data.created.map(c => c.name)).toEqual(['packed'])
    expect(existsSync(join(home, '.agents/skills/packed/scripts/run.sh'))).toBe(true)
  })

  test('never overwrites an existing skill; reports the clash', async () => {
    const data = ((await (await upload([{ name: 'again.md', data: '---\nname: fresh\ndescription: x\n---\n' }])).json()) as { data: UploadResult }).data
    expect(data.created).toEqual([])
    expect(data.conflicts).toEqual(['fresh'])
    expect(readFileSync(join(home, '.agents/skills/fresh/SKILL.md'), 'utf8')).toContain('description: d')
  })

  test('rejects archives with paths escaping the skill, and unsupported files', async () => {
    const evil = zipSync({ 'evil/SKILL.md': strToU8('---\nname: evil\n---\n'), '../../escape.txt': strToU8('x') })
    expect((await upload([{ name: 'evil.zip', data: evil }])).status).toBe(400)
    expect(existsSync(join(home, '.agents/skills/evil'))).toBe(false)
    expect((await upload([{ name: 'notes.txt', data: 'x' }])).status).toBe(400)
  })

  test('rejects archives that inflate past the size limit before writing anything', async () => {
    const big = zipSync({ 'big/SKILL.md': strToU8('---\nname: big\n---\n'), 'big/blob.bin': new Uint8Array(60 * 1024 * 1024) })
    expect((await upload([{ name: 'big.zip', data: big }])).status).toBe(400)
    expect(existsSync(join(home, '.agents/skills/big'))).toBe(false)
  })
})
