import { useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createFmClient } from '@/fm/client/client'
import { fmKeys, useMounts } from '@/fm/client/hooks'
import { markdownPlugin } from '@/fm/plugins/markdown'
import { reviewPlugin } from '@/fm/plugins/review'
import { FileManager } from '@/fm/react/file-manager'
import { enLabels, zhLabels } from '@/fm/react/labels'
import { eventBus } from '@/lib/event-bus'

const plugins = [markdownPlugin(), reviewPlugin()]

/**
 * The file manager over a project's directories (`/api/fm/:projectId`). It
 * shows one drive: the issue's worktree when the issue has one, else the
 * project directory (with one drive fm drops "Manage drives"), and refreshes
 * its listings when an issue's changes settle.
 */
export function WorkspaceFiles({ projectId, issueId, headerActions }: {
  projectId: string
  issueId?: string | null
  /** Host controls for the manager's top bar. */
  headerActions?: ReactNode
}) {
  const { i18n } = useTranslation()
  const queryClient = useQueryClient()
  const client = useMemo(() => createFmClient({ baseUrl: `/api/fm/${projectId}` }), [projectId])
  const mounts = useMounts(client)

  // An agent changed files: refresh the listings, not an open file (it may hold an edit)
  useEffect(() => eventBus.onChangesSummary(() => {
    void queryClient.invalidateQueries({ queryKey: [...fmKeys.all(client), 'list'] })
  }), [client, queryClient])

  // The manager renders the error / empty states itself
  if (mounts.isPending) return null
  const worktree = issueId ? `wt-${issueId}` : undefined
  const initialMount = mounts.data?.some(m => m.id === worktree) ? worktree : 'project'
  const hidden = (mounts.data ?? []).map(m => m.id).filter(id => id !== initialMount)

  return (
    <FileManager
      key={`${projectId}:${initialMount}`}
      client={client}
      labels={i18n.language.startsWith('zh') ? zhLabels : enLabels}
      initialMount={initialMount}
      plugins={plugins}
      sidebar={{ hidden }}
      headerActions={headerActions}
      storageKey="bkd-fm"
      className="flex-1 rounded-none border-0"
    />
  )
}
