import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCommand } from '@/engines/spawn'
import { findProject } from '@/db/helpers'
import { dirtyNotTouched, getAiTouchedFiles, partitionByPresence } from '@/services/ai-changes'
import { getFileTimeline } from '@/services/ai-changes-timeline'
import { checkOversized, countTextLines, isPathInsideRoot, resolveIssueDir } from '@/utils/changes'
import { isGitRepo } from '@/utils/git'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { getProjectOwnedIssue } from './_shared'

// ---------- Types ----------

export type ChangeType = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'unknown'

export interface GitChangedFile {
  path: string
  status: string
  type: ChangeType
  staged: boolean
  unstaged: boolean
  previousPath?: string
  additions?: number
  deletions?: number
  /** true when the file exceeds the large-file threshold (20 MB) */
  oversized?: boolean
  /** human-readable file size (only set when oversized) */
  sizeDisplay?: string
}

// ---------- Git helpers ----------

async function resolveProjectDir(projectId: string): Promise<string | null> {
  const project = await findProject(projectId)
  if (!project?.directory) return null
  const root = resolve(project.directory)
  try {
    const s = await stat(root)
    if (!s.isDirectory()) return null
  } catch {
    return null
  }
  return root
}

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number, stdout: string, timedOut?: boolean }> {
  return runCommand(['git', ...args], { cwd, timeout: 15_000 })
}

function parsePorcelainLine(line: string): GitChangedFile | null {
  if (line.length < 3) return null
  const x = line[0]
  const y = line[1]
  const status = `${x}${y}`
  const rest = line.slice(3).trim()
  const hasRenameArrow = rest.includes(' -> ')
  const previousPath = hasRenameArrow ? rest.split(' -> ')[0]?.trim() : undefined
  const path = hasRenameArrow ? rest.split(' -> ').at(-1)?.trim() || rest : rest
  if (!path) return null

  let type: ChangeType = 'unknown'
  if (status === '??') type = 'untracked'
  else if (x === 'R' || y === 'R') type = 'renamed'
  else if (x === 'A' || y === 'A') type = 'added'
  else if (x === 'D' || y === 'D') type = 'deleted'
  else if (x === 'M' || y === 'M') type = 'modified'

  const staged = x !== ' ' && x !== '?'
  const unstaged = y !== ' ' && y !== '?'
  return { path, status, type, staged, unstaged, previousPath }
}

export async function listChangedFiles(cwd: string): Promise<{ files: GitChangedFile[], timedOut?: boolean }> {
  const result = await runGit(['status', '--porcelain=v1', '-uall'], cwd)
  if (result.timedOut) return { files: [], timedOut: true }
  if (result.code !== 0) return { files: [] }
  const { stdout } = result
  const parsed = stdout
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(parsePorcelainLine)
    .filter((f): f is GitChangedFile => !!f)
    .sort((a, b) => a.path.localeCompare(b.path))

  // Check file sizes in parallel and merge oversized flags (immutable)
  const sizeFlags = await Promise.all(
    parsed.map(file => checkOversized(cwd, file.path)),
  )
  const files = parsed.map((file, i) => sizeFlags[i] ? { ...file, ...sizeFlags[i] } : file)
  return { files }
}

export async function summarizeFileLines(
  cwd: string,
  file: GitChangedFile,
): Promise<{ additions: number, deletions: number }> {
  // Skip diff for oversized files — they would block the event loop or OOM
  if (file.oversized) return { additions: 0, deletions: 0 }

  if (file.type === 'untracked') {
    if (!isPathInsideRoot(cwd, file.path)) return { additions: 0, deletions: 0 }
    try {
      const content = await Bun.file(resolve(cwd, file.path)).text()
      return { additions: countTextLines(content), deletions: 0 }
    } catch {
      return { additions: 0, deletions: 0 }
    }
  }

  // Single diff against HEAD: covers both staged and unstaged changes,
  // avoids double-counting partially staged hunks, handles renames with -M
  try {
    const { code, stdout } = await runGit(
      ['diff', 'HEAD', '-M', '--numstat', '--no-color', '--no-ext-diff', '--', file.path],
      cwd,
    )
    if (code === 0) {
      const firstLine = stdout
        .split('\n')
        .map(line => line.trim())
        .find(Boolean)
      if (firstLine) {
        const [addRaw, delRaw] = firstLine.split('\t')
        const additions = Number.isNaN(Number(addRaw)) ? 0 : Number(addRaw)
        const deletions = Number.isNaN(Number(delRaw)) ? 0 : Number(delRaw)
        return { additions, deletions }
      }
    }
  } catch {
    // fall through
  }

  return { additions: 0, deletions: 0 }
}

// ---------- Routes ----------

const changes = createOpenAPIRouter()

// GET /api/projects/:projectId/issues/:issueId/changes — Get changed files from git workspace
changes.openapi(R.getIssueChanges, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404 as const)

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) return c.json({ success: false, error: 'Issue not found' }, 404 as const)

  const projectRoot = await resolveProjectDir(project.id)
  if (!projectRoot) {
    return c.json({ success: false, error: 'Project directory is not configured' }, 400 as const)
  }
  const root = await resolveIssueDir(project.id, issueId, issue.useWorktree, projectRoot)
  const gitRepo = await isGitRepo(root)
  if (!gitRepo) {
    return c.json({
      success: true,
      data: { root, gitRepo: false, files: [], additions: 0, deletions: 0 },
    }, 200 as const)
  }

  const { files, timedOut } = await listChangedFiles(root)

  if (timedOut) {
    return c.json({
      success: true,
      data: { root, gitRepo: true, files: [], additions: 0, deletions: 0, timedOut: true },
    }, 200 as const)
  }

  const filesWithStats = await Promise.all(
    files.map(async file => ({
      ...file,
      ...(await summarizeFileLines(root, file)),
    })),
  )
  const additions = filesWithStats.reduce((sum, file) => sum + (file.additions ?? 0), 0)
  const deletions = filesWithStats.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
  return c.json({
    success: true,
    data: { root, gitRepo: true, files: filesWithStats, additions, deletions },
  }, 200 as const)
})

// GET /api/projects/:projectId/issues/:id/changes/file?path=... — Get file patch from workspace
// Stays as regular route since it's a sub-route not covered by OpenAPI
changes.get('/:id/changes/file', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404)

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) return c.json({ success: false, error: 'Issue not found' }, 404)

  const path = c.req.query('path')?.trim()
  if (!path) return c.json({ success: false, error: 'Missing path' }, 400)

  // SEC-019: Validate path against injection
  if (path.startsWith('-')) {
    return c.json({ success: false, error: 'Invalid path: must not start with -' }, 400)
  }
  if (path.includes(':')) {
    return c.json({ success: false, error: 'Invalid path: must not contain :' }, 400)
  }

  const projectRoot = await resolveProjectDir(project.id)
  if (!projectRoot) {
    return c.json({ success: false, error: 'Project directory is not configured' }, 400)
  }
  const root = await resolveIssueDir(project.id, issueId, issue.useWorktree, projectRoot)

  // SEC-019: Validate path is inside working directory on ALL code paths
  if (!isPathInsideRoot(root, path)) {
    return c.json({ success: false, error: 'Invalid path' }, 400)
  }

  const gitRepo = await isGitRepo(root)
  if (!gitRepo) {
    return c.json({
      success: true,
      data: { path, patch: '', truncated: false },
    })
  }

  const { files: changedFiles, timedOut: listTimedOut } = await listChangedFiles(root)
  if (listTimedOut) {
    return c.json({
      success: true,
      data: { path, patch: '', truncated: false, timedOut: true },
    })
  }
  const file = changedFiles.find(f => f.path === path)
  if (!file) {
    return c.json({
      success: true,
      data: { path, patch: '', truncated: false },
    })
  }

  // Refuse to diff oversized files
  if (file.oversized) {
    return c.json({
      success: true,
      data: {
        path,
        patch: '',
        oldText: '',
        newText: '',
        truncated: false,
        type: file.type,
        status: file.status,
        oversized: true,
        sizeDisplay: file.sizeDisplay,
      },
    })
  }

  let patch = ''
  let oldText = ''
  let newText = ''
  if (file.type === 'untracked') {
    const abs = resolve(root, path)

    // Use git's own no-index diff output for new files to keep hunk/line
    // numbering and file headers fully compatible with diff renderers.
    const untrackedDiff = await runGit(
      ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', path],
      root,
    )
    patch = untrackedDiff.stdout

    const content = await Bun.file(abs).text()
    oldText = ''
    newText = content
  } else {
    // Single `git diff HEAD` covers staged + unstaged hunks in one shot,
    // so files with mixed staged/unstaged changes don't drop the staged
    // portion (which the prior `unstaged → staged fallback` did when
    // unstaged was non-empty). `-M` enables rename detection so the patch
    // headers match the per-file numstat path.
    const combined = await runGit(
      ['diff', 'HEAD', '-M', '--no-color', '--no-ext-diff', '--', path],
      root,
    )
    patch = combined.stdout

    const oldPath = file.previousPath ?? path
    // SEC-019: Validate previousPath too
    if (oldPath.startsWith('-') || oldPath.includes(':')) {
      return c.json({ success: false, error: 'Invalid path' }, 400)
    }
    if (!isPathInsideRoot(root, oldPath)) {
      return c.json({ success: false, error: 'Invalid path' }, 400)
    }
    const oldShow = await runGit(['show', `HEAD:${oldPath}`], root)
    if (oldShow.code === 0) {
      oldText = oldShow.stdout
    }

    if (file.type !== 'deleted') {
      const abs = resolve(root, path)
      try {
        newText = await Bun.file(abs).text()
      } catch {
        newText = ''
      }
    }
  }

  const maxChars = 200_000
  const truncated = patch.length > maxChars
  if (truncated) patch = `${patch.slice(0, maxChars)}\n\n... [truncated]`

  return c.json({
    success: true,
    data: {
      path,
      patch,
      oldText:
        oldText.length > maxChars ? `${oldText.slice(0, maxChars)}\n... [truncated]` : oldText,
      newText:
        newText.length > maxChars ? `${newText.slice(0, maxChars)}\n... [truncated]` : newText,
      truncated,
      type: file.type,
      status: file.status,
    },
  })
})

// GET /api/projects/:projectId/issues/:issueId/ai-changes
// Returns the files the agent itself reported editing (Edit/Write/MultiEdit
// tool calls), cross-referenced with the current git working tree so the UI
// can show "files the agent edited that are still dirty on disk", "files the
// agent edited that are now clean again (likely reverted)", and "dirty files
// the agent did NOT report editing (bash / lockfile / manual)".
changes.get('/:id/ai-changes', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404)

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) return c.json({ success: false, error: 'Issue not found' }, 404)

  const projectRoot = await resolveProjectDir(project.id)
  const root = projectRoot
    ? await resolveIssueDir(project.id, issueId, issue.useWorktree, projectRoot)
    : projectRoot

  // 1. Mine the tool-call log for AI-attributed edits (works without git).
  const touched = root
    ? await getAiTouchedFiles(issueId, root)
    : await getAiTouchedFiles(issueId, '/')

  // 2. If we have a git working tree, compute dirty paths so we can split
  //    touched files into "still dirty" vs "reverted" and surface the
  //    "dirty but not touched" set (bash / lockfile / manual edits).
  let dirtyPaths: string[] = []
  let gitRepo = false
  let timedOut = false
  if (root && await isGitRepo(root)) {
    gitRepo = true
    const listing = await listChangedFiles(root)
    timedOut = listing.timedOut ?? false
    dirtyPaths = listing.files.map(f => f.path)
  }

  const dirtySet = new Set(dirtyPaths)
  const { onDisk, reverted } = partitionByPresence(touched, dirtySet)
  const notTouched = dirtyNotTouched(dirtyPaths, touched)

  return c.json({
    success: true,
    data: {
      root,
      gitRepo,
      timedOut,
      onDisk,
      reverted,
      dirtyNotTouched: notTouched,
    },
  })
})

// GET /api/projects/:projectId/issues/:id/ai-changes/file?path=...
// Per-file timeline + reconstructed net effect (baseline → final buffer).
// Used by DiffPanel's "agent timeline" view to render per-turn edits and
// the synthesized diff that doesn't depend on git.
changes.get('/:id/ai-changes/file', async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) return c.json({ success: false, error: 'Project not found' }, 404)

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) return c.json({ success: false, error: 'Issue not found' }, 404)

  const path = c.req.query('path')?.trim()
  if (!path) return c.json({ success: false, error: 'Missing path' }, 400)

  const timeline = await getFileTimeline(issueId, path)
  if (!timeline) {
    return c.json({
      success: true,
      data: null,
    })
  }
  return c.json({ success: true, data: timeline })
})

export default changes
