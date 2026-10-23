import { dirname } from 'node:path'
import process from 'node:process'
import type { SkillUpdateStatus } from '@bkd/shared'
import { globalRoots, isHomeDir, listSkills, projectRoots, readLock } from './service'

/*
 * Whether an installed skill has a newer version: the lock records the git
 * tree hash of the skill folder at install time (`skillFolderHash`); GitHub's
 * tree API gives the current one. This is the comparison `skills update`
 * makes, done read-only and once per source repository and ref, cached.
 */

const CACHE_MS = 10 * 60 * 1000
const SOURCE_RE = /^[\w.-]+\/[\w.-]+$/

export interface GithubTree {
  /** Root tree hash */
  sha: string
  tree: { path: string, type: string, sha: string }[]
}
/** `ref` is the branch or tag recorded at install time; absent means the default branch. */
export type GithubTreeFetcher = (source: string, ref?: string) => Promise<GithubTree>

const githubFetcher: GithubTreeFetcher = async (source, ref) => {
  const headers: Record<string, string> = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'bkd' }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com/repos/${source}/git/trees/${encodeURIComponent(ref ?? 'HEAD')}?recursive=1`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${source}`)
  return (await res.json()) as GithubTree
}

let fetcher: GithubTreeFetcher = githubFetcher
const cache = new Map<string, { at: number, tree: Promise<Map<string, string> | null> }>()

/** Tests replace GitHub; `null` restores it. */
export function setGithubTreeFetcher(next: GithubTreeFetcher | null): void {
  fetcher = next ?? githubFetcher
  cache.clear()
}

export function resetSkillUpdateCache(): void {
  cache.clear()
}

/** Folder path → tree hash ('' is the repository root), or null when the repo cannot be read. */
function folderHashes(source: string, ref?: string): Promise<Map<string, string> | null> {
  const key = `${source}#${ref ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.tree
  const tree = fetcher(source, ref)
    .then((t) => {
      const map = new Map<string, string>([['', t.sha]])
      for (const e of t.tree) {
        if (e.type === 'tree') map.set(e.path, e.sha)
      }
      return map
    })
    .catch(() => null)
  cache.set(key, { at: Date.now(), tree })
  return tree
}

export async function checkSkillUpdates(projectDir?: string | null): Promise<SkillUpdateStatus[]> {
  const skills = (await listSkills(projectDir)).filter(s => s.managed)
  const locks = {
    global: await readLock(globalRoots().lockFile),
    project: projectDir && !(await isHomeDir(projectDir)) ? await readLock(projectRoots(projectDir).lockFile) : {},
  }
  return Promise.all(skills.map(async (skill): Promise<SkillUpdateStatus> => {
    const entry = locks[skill.scope][skill.name]
    const base = { location: skill.location, name: skill.name }
    if (!entry?.source || !SOURCE_RE.test(entry.source) || (entry.sourceType && entry.sourceType !== 'github') || !entry.skillPath || !entry.skillFolderHash) {
      return { ...base, status: 'unknown' }
    }
    const hashes = await folderHashes(entry.source, entry.ref || undefined)
    if (!hashes) return { ...base, status: 'unknown' }
    const folder = dirname(entry.skillPath) === '.' ? '' : dirname(entry.skillPath)
    const remote = hashes.get(folder)
    if (!remote) return { ...base, status: 'removed' }
    return { ...base, status: remote === entry.skillFolderHash ? 'latest' : 'update' }
  }))
}
