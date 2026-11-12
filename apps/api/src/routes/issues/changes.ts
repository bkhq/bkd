import { FilePatchSchema } from '@/openapi/extra-schemas'
import { errorResponse, successResponse } from '@/openapi/schemas'
import * as z from 'zod'
import { createRoute } from '@hono/zod-openapi'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { findProject } from '@/db/helpers'
import { collectChanges, isPathInsideRoot, listChangedFiles, resolveIssueDir, runGit } from '@/utils/changes'
import { isGitRepo } from '@/utils/git'
import { createOpenAPIRouter } from '@/openapi/hono'
import * as R from '@/openapi/routes'
import { getProjectOwnedIssue } from './_shared'

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

// ---------- Routes ----------

const changes = createOpenAPIRouter()

// GET /api/projects/:projectId/issues/:issueId/changes — Get changed files from git workspace
changes.openapi(R.getIssueChanges, async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) return c.json({ success: false as const, error: 'Project not found' }, 404 as const)

  const issueId = c.req.param('issueId')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) return c.json({ success: false as const, error: 'Issue not found' }, 404 as const)

  const projectRoot = await resolveProjectDir(project.id)
  if (!projectRoot) {
    // Project has no working directory configured (or it no longer exists).
    // Treat as "no changes to report" rather than an error so callers (chat
    // input file-count badge, etc.) can render cleanly without a 400.
    return c.json({
      success: true as const,
      data: { gitRepo: false, files: [], additions: 0, deletions: 0 },
    }, 200 as const)
  }
  const root = await resolveIssueDir(project.id, issueId, issue.useWorktree, projectRoot)
  // resolveIssueDir falls back to the project root when the worktree does not
  // exist (not created yet, or cleaned up); say so, or clients would take the
  // main checkout for the issue workspace
  const worktreeMissing = issue.useWorktree && root === projectRoot ? true : undefined
  const gitRepo = await isGitRepo(root)
  // The main checkout's changes are not the issue's: report none
  if (worktreeMissing) {
    return c.json({
      success: true as const,
      data: { root, worktreeMissing, gitRepo, files: [], additions: 0, deletions: 0 },
    }, 200 as const)
  }
  if (!gitRepo) {
    return c.json({
      success: true as const,
      data: { root, worktreeMissing, gitRepo: false, files: [], additions: 0, deletions: 0 },
    }, 200 as const)
  }

  const { files, additions, deletions, timedOut } = await collectChanges(root)
  return c.json({
    success: true as const,
    data: { root, worktreeMissing, gitRepo: true, files, additions, deletions, ...(timedOut ? { timedOut } : {}) },
  }, 200 as const)
})

// GET /api/projects/:projectId/issues/:id/changes/file?path=... — Get file patch from workspace
// Stays as regular route since it's a sub-route not covered by OpenAPI
changes.openapi(createRoute({
  method: 'get',
  path: '/{id}/changes/file',
  tags: ['Issues'],
  operationId: 'getIssuesChangesChangesFile',
  request: { params: z.object({ projectId: z.string().min(1), id: z.string().min(1) }), query: z.object({ path: z.string().trim().min(1) }) },
  responses: {
    200: successResponse(FilePatchSchema, 'Success'),
    400: errorResponse('Invalid request'),
    404: errorResponse('Not found'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Conflict'),
    415: errorResponse('Unsupported media type'),
    500: errorResponse('Internal error'),
  },
}), async (c) => {
  const projectId = c.req.param('projectId')!
  const project = await findProject(projectId)
  if (!project) return c.json({ success: false as const, error: 'Project not found' }, 404)

  const issueId = c.req.param('id')!
  const issue = await getProjectOwnedIssue(project.id, issueId)
  if (!issue) return c.json({ success: false as const, error: 'Issue not found' }, 404)

  const path = c.req.query('path')?.trim()
  if (!path) return c.json({ success: false as const, error: 'Missing path' }, 400)

  // Validate path against injection
  if (path.startsWith('-')) {
    return c.json({ success: false as const, error: 'Invalid path: must not start with -' }, 400)
  }
  if (path.includes(':')) {
    return c.json({ success: false as const, error: 'Invalid path: must not contain :' }, 400)
  }

  const projectRoot = await resolveProjectDir(project.id)
  if (!projectRoot) {
    // No working dir → nothing to diff. Return empty patch payload instead
    // of 400 so the diff panel renders cleanly.
    return c.json({
      success: true as const,
      data: { path, patch: '', truncated: false },
    }, 200)
  }
  const root = await resolveIssueDir(project.id, issueId, issue.useWorktree, projectRoot)
  // A missing worktree falls back to the main checkout, whose files are not the issue's
  if (issue.useWorktree && root === projectRoot) {
    return c.json({
      success: true as const,
      data: { path, patch: '', truncated: false },
    }, 200)
  }

  // Validate path is inside working directory on ALL code paths
  if (!isPathInsideRoot(root, path)) {
    return c.json({ success: false as const, error: 'Invalid path' }, 400)
  }

  const gitRepo = await isGitRepo(root)
  if (!gitRepo) {
    return c.json({
      success: true as const,
      data: { path, patch: '', truncated: false },
    }, 200)
  }

  const { files: changedFiles, timedOut: listTimedOut } = await listChangedFiles(root)
  if (listTimedOut) {
    return c.json({
      success: true as const,
      data: { path, patch: '', truncated: false, timedOut: true },
    }, 200)
  }
  const file = changedFiles.find(f => f.path === path)
  if (!file) {
    return c.json({
      success: true as const,
      data: { path, patch: '', truncated: false },
    }, 200)
  }

  // Refuse to diff oversized files
  if (file.oversized) {
    return c.json({
      success: true as const,
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
    }, 200)
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
    // Try unstaged diff first; fall back to staged diff if empty (fully staged files)
    const unstaged = await runGit(['diff', '--no-color', '--no-ext-diff', '--', path], root)
    patch = unstaged.stdout
    if (!patch.trim()) {
      const staged = await runGit(['diff', '--cached', '--no-color', '--no-ext-diff', '--', path], root)
      patch = staged.stdout
    }

    const oldPath = file.previousPath ?? path
    // Validate previousPath too
    if (oldPath.startsWith('-') || oldPath.includes(':')) {
      return c.json({ success: false as const, error: 'Invalid path' }, 400)
    }
    if (!isPathInsideRoot(root, oldPath)) {
      return c.json({ success: false as const, error: 'Invalid path' }, 400)
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
    success: true as const,
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
  }, 200)
})

export default changes
