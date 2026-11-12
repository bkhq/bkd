import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateIssue } from '@/hooks/use-kanban'
import { isImeComposing } from '@/lib/keyboard'
import type { Issue } from '@/types/kanban'

/** Issue number and title of an issue header; clicking the title edits it in place. */
export function IssueTitle({ projectId, issue }: { projectId: string, issue: Issue | undefined }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const updateIssue = useUpdateIssue(projectId)

  const save = () => {
    const trimmed = draft.trim()
    if (trimmed && issue && trimmed !== issue.title) {
      updateIssue.mutate({ id: issue.id, title: trimmed })
    }
    setEditing(false)
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5 shrink-0 tabular-nums">
          {issue ? `#${issue.issueNumber}` : ''}
        </span>
        {editing ?
            (
              <input
                className="text-base md:text-sm font-semibold bg-transparent border-b-2 border-primary outline-none min-w-0 flex-1 tracking-tight"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isImeComposing(e)) {
                    e.preventDefault()
                    save()
                  } else if (e.key === 'Escape') {
                    setEditing(false)
                  }
                }}
                autoFocus
              />
            ) :
            (
              <span
                className="text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors duration-200 tracking-tight decoration-primary/30 hover:underline underline-offset-2"
                onClick={() => {
                  if (!issue) return
                  setDraft(issue.title)
                  setEditing(true)
                }}
                title={t('issue.editTitle')}
              >
                {issue?.title}
              </span>
            )}
      </div>
    </div>
  )
}
