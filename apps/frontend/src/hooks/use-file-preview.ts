import { useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useFileBrowserStore } from '@/stores/file-browser-store'
import { sortKnownPaths } from '@/lib/path-chips'
import { useIssueChanges, useProject } from './use-kanban'

/**
 * Chat-side hook for the "click a path → open file preview drawer" flow.
 *
 * Derives:
 *  - `knownPaths`: sorted whitelist of files the AI has already touched in
 *    the current issue (sourced from `/changes`). Used by free-text chip
 *    matching inside assistant messages — never used to suppress clicks on
 *    explicit tool-call paths.
 *  - `openPreview`: ready-to-bind click handler that opens the file browser
 *    drawer at the requested path and optional line. Worktree-aware: prefers
 *    the issue's resolved root, falls back to `project.directory`.
 *
 * Returns `hasPreview === false` when called outside an issue route, so
 * components can render a non-clickable fallback chip.
 */
export function useFilePreview(): {
  knownPaths: string[]
  openPreview: (path: string, line?: number) => void
  hasPreview: boolean
} {
  const params = useParams<{ projectId?: string, issueId?: string }>()
  const projectId = params.projectId ?? ''
  const issueId = params.issueId ?? ''

  const hasIssue = !!projectId && !!issueId
  const { data: changes } = useIssueChanges(projectId, issueId, hasIssue)
  const { data: project } = useProject(projectId)
  const openAt = useFileBrowserStore(s => s.openAt)

  const knownPaths = useMemo(
    () => sortKnownPaths(changes?.files.map(f => f.path) ?? []),
    [changes],
  )

  const openPreview = useCallback(
    (path: string, line?: number) => {
      if (!projectId) return
      // Prefer the worktree-aware root reported by /changes; fall back to
      // the project's configured directory so non-worktree issues still work.
      const root = changes?.root ?? project?.directory
      openAt({
        projectId,
        issueId: issueId || null,
        rootPath: root,
        path,
        line,
      })
    },
    [projectId, issueId, changes?.root, project?.directory, openAt],
  )

  return {
    knownPaths,
    openPreview,
    hasPreview: hasIssue,
  }
}
