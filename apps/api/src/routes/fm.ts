import type { Context } from 'hono'
import type { FmDriver, FmDriverEntry } from '@/fm/server/driver'
import type { FmMount } from '@/fm/server/router'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { findProject, getAppSetting } from '@/db/helpers'
import { WORKTREE_BASE } from '@/engines/issue/utils/worktree'
import { FmError } from '@/fm/core/errors'
import { localDriver } from '@/fm/drivers/local'
import { createFmRouter } from '@/fm/server/router'
import { TRASH_DIR } from '@/fm/server/trash'
import { DATA_DIR } from '@/root'
import { getProjectOwnedIssue } from './issues/_shared'

/** Folders the fm router keeps per mount; BKD stores them under `data/`, never in a project. */
const HIDDEN_DIRS = [TRASH_DIR, '/.fm-uploads']
export const TRASH_RETENTION_DAYS = 7

/** Root of the hidden folders for each served directory: `data/fm/<hash of the root>/`. */
export function fmDataDir(): string {
  return process.env.BKD_FM_DATA_DIR || join(DATA_DIR, 'fm')
}

function dataDirFor(root: string): string {
  return join(fmDataDir(), createHash('sha256').update(root).digest('hex').slice(0, 16))
}

const isHidden = (path: string) => HIDDEN_DIRS.some(dir => path === dir || path.startsWith(`${dir}/`))
const inside = (path: string, root: string) => path === root || path.startsWith(root + sep)

/**
 * Absolute path of a mount path under `root`, refusing one whose nearest existing
 * ancestor resolves (through symlinks) outside `root`, as the local driver does.
 */
async function jailed(root: string, path: string): Promise<string> {
  const target = join(root, path.slice(1))
  const realRoot = await realpath(root)
  for (let probe = target; ; probe = dirname(probe)) {
    const real = await realpath(probe).catch(() => null)
    if (real !== null) {
      if (!inside(real, realRoot)) throw new FmError('NOT_FOUND', `Not found: ${path}`)
      return target
    }
    if (probe === root) throw new FmError('NOT_FOUND', `Not found: ${path}`)
  }
}

/** Move across the two roots: one rename, or copy + remove between filesystems. */
async function crossMove(from: string, to: string): Promise<void> {
  if (await stat(to).then(() => true, () => false)) throw new FmError('EXISTS', 'Target exists')
  await mkdir(dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await cp(from, to, { recursive: true, verbatimSymlinks: true })
    await rm(from, { recursive: true, force: true })
  }
}

/**
 * A directory as an fm driver: the trash and upload-session folders the router
 * keeps on the mount are redirected to `data/fm/<hash>/`. `git` adds ignore marks and review.
 */
export function workspaceDriver(root: string, { git = true }: { git?: boolean } = {}): FmDriver {
  const side = dataDirFor(root)
  const main = localDriver({ root, gitIgnore: git, gitChanges: git, uploadDir: join(side, 'parts') })
  const hidden = localDriver({ root: side })
  const pick = (path: string) => (isHidden(path) ? hidden : main)
  const ensureSide = () => mkdir(side, { recursive: true })

  return {
    ...main,
    stat: async path => (isHidden(path) ? ensureSide().then(() => hidden.stat(path)) : main.stat(path)),
    list: async path => (isHidden(path) ? ensureSide().then(() => hidden.list(path)) : main.list(path)),
    read: (path, range) => pick(path).read(path, range),
    write: async (path, body, opts) => {
      if (isHidden(path)) await ensureSide()
      return pick(path).write(path, body, opts)
    },
    mkdir: async (path, ctx) => {
      if (isHidden(path)) await ensureSide()
      return pick(path).mkdir(path, ctx)
    },
    remove: (path, ctx) => pick(path).remove(path, ctx),
    copy: (from, to, ctx) => {
      if (isHidden(from) !== isHidden(to)) throw new FmError('INVALID', 'Cannot copy across the trash')
      return pick(from).copy(from, to, ctx)
    },
    move: async (from, to, ctx): Promise<FmDriverEntry> => {
      if (isHidden(from) === isHidden(to)) return pick(from).move(from, to, ctx)
      // Delete into the trash, or restore out of it
      await ensureSide()
      const [fromRoot, toRoot] = isHidden(from) ? [side, root] : [root, side]
      await pick(from).stat(from)
      await crossMove(await jailed(fromRoot, from), await jailed(toRoot, to))
      return pick(to).stat(to)
    },
  }
}

/** The directory is inside the configured workspace (SEC-007); `/` or unset allows all. */
async function insideWorkspace(dir: string): Promise<boolean> {
  const workspace = await getAppSetting('workspace:defaultPath')
  return !workspace || workspace === '/' || inside(dir, resolve(workspace))
}

async function isDir(path: string): Promise<boolean> {
  return stat(path).then(s => s.isDirectory(), () => false)
}

/**
 * Mounts of one project: its directory (`project`) and each issue worktree that
 * exists (`wt-<issueId>`). None for an unknown project or one outside the workspace.
 */
export async function projectMounts(projectId: string): Promise<FmMount[]> {
  const project = await findProject(projectId)
  if (!project?.directory) return []
  const root = resolve(project.directory)
  if (!(await isDir(root)) || !(await insideWorkspace(root))) return []

  const trash = { retentionDays: TRASH_RETENTION_DAYS }
  const mounts: FmMount[] = [{ id: 'project', label: project.name, driver: workspaceDriver(root), trash }]
  const worktrees = await readdir(join(WORKTREE_BASE, project.id), { withFileTypes: true }).catch(() => [])
  for (const dirent of worktrees) {
    if (!dirent.isDirectory()) continue
    const issue = await getProjectOwnedIssue(project.id, dirent.name)
    if (!issue) continue
    mounts.push({
      id: `wt-${issue.id}`,
      label: `#${issue.issueNumber} ${issue.title}`,
      driver: workspaceDriver(join(WORKTREE_BASE, project.id, issue.id)),
      trash,
    })
  }
  return mounts
}

/** fm routes that return file bytes (previews, downloads) rather than JSON. */
export function isFmContentPath(path: string): boolean {
  return /^\/api\/(?:skills\/)?fm\/[^/]+\/m\/[^/]+\/(?:read|thumb|zip\/read)$/.test(path)
}

/**
 * CSP of a file served by fm: its own sandboxing policy, framable by the app
 * for previews. PDFs drop the sandbox, which keeps the browser's PDF viewer
 * from rendering; their script runs in the viewer, not on this origin.
 */
export function fmContentPolicy(contentType: string | null, policy: string | null): string {
  if (contentType?.startsWith('application/pdf')) return 'frame-ancestors \'self\''
  return `${policy ?? 'default-src \'none\'; sandbox'}; frame-ancestors 'self'`
}

/** `/api/fm/:projectId/*` — the file manager over one project's directories. */
const fm = createFmRouter({
  mounts: (c: Context) => projectMounts(c.req.param('projectId') ?? ''),
})

export default fm
