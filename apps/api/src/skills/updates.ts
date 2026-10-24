import { dirname } from 'node:path'
import process from 'node:process'
import type { SkillLocation, SkillUpdateStatus } from '@bkd/shared'
import { findLockEntry, globalRoots, isHomeDir, listSkills, projectRoots, readLock } from './service'

/*
 * Whether an installed skill has a newer version: the lock records the git
 * tree hash of the skill folder at install time (`skillFolderHash`); GitHub's
 * tree API gives the current one. This is the comparison `skills update`
 * makes, done read-only and once per source repository and ref in a check.
 * Checks run only when the user asks, so nothing is cached between them.
 */

const SOURCE_RE = /^[\w.-]+\/[\w.-]+$/
/** A content sha256 the CLI records when GitHub's tree API was unavailable at install; no tree hash compares with it. */
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/i

export interface GithubTree {
  /** Root tree hash */
  sha: string
  /** Set by GitHub when a large repository's recursive listing is partial */
  truncated?: boolean
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

/** Tests replace GitHub; `null` restores it. */
export function setGithubTreeFetcher(next: GithubTreeFetcher | null): void {
  fetcher = next ?? githubFetcher
}

interface FolderHashes {
  /** Folder path → tree hash ('' is the repository root) */
  hashes: Map<string, string>
  /** A folder missing from a truncated listing may still exist */
  truncated: boolean
}

/** Folder hashes of a repository at a ref, or null when it cannot be read. */
function folderHashes(source: string, ref?: string): Promise<FolderHashes | null> {
  return fetcher(source, ref)
    .then((t) => {
      const map = new Map<string, string>([['', t.sha]])
      for (const e of t.tree) {
        if (e.type === 'tree') map.set(e.path, e.sha)
      }
      return { hashes: map, truncated: !!t.truncated }
    })
    .catch(() => null)
}

/** Update status of installed skills, or of the one named by `only`. */
export async function checkSkillUpdates(
  projectDir?: string | null,
  only?: { location: SkillLocation, name: string },
): Promise<SkillUpdateStatus[]> {
  const skills = (await listSkills(projectDir))
    .filter(s => s.managed && (!only || (s.location === only.location && s.name === only.name)))
  // One request per source repository and ref within this check
  const repos = new Map<string, Promise<FolderHashes | null>>()
  const repoAt = (source: string, ref?: string) => {
    const key = `${source}#${ref ?? ''}`
    if (!repos.has(key)) repos.set(key, folderHashes(source, ref))
    return repos.get(key)!
  }
  const locks = {
    global: await readLock(globalRoots().lockFile) ?? {},
    project: projectDir && !(await isHomeDir(projectDir)) ? await readLock(projectRoots(projectDir).lockFile) ?? {} : {},
  }
  return Promise.all(skills.map(async (skill): Promise<SkillUpdateStatus> => {
    const entry = findLockEntry(locks[skill.scope], skill.name)?.[1]
    const base = { location: skill.location, name: skill.name }
    if (!entry?.source || !SOURCE_RE.test(entry.source) || (entry.sourceType && entry.sourceType !== 'github') || !entry.skillPath || !entry.skillFolderHash || CONTENT_HASH_RE.test(entry.skillFolderHash)) {
      return { ...base, status: 'unknown' }
    }
    const repo = await repoAt(entry.source, entry.ref || undefined)
    if (!repo) return { ...base, status: 'unknown' }
    const folder = dirname(entry.skillPath) === '.' ? '' : dirname(entry.skillPath)
    const remote = repo.hashes.get(folder)
    if (!remote) return { ...base, status: repo.truncated ? 'unknown' : 'removed' }
    return { ...base, status: remote === entry.skillFolderHash ? 'latest' : 'update' }
  }))
}
