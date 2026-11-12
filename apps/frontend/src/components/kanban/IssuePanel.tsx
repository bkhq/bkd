import { Check, Link, Maximize2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChatBody } from '@/components/issue-detail/ChatBody'
import { Button } from '@/components/ui/button'
import { IssueTitle } from '@/components/issue-detail/IssueTitle'
import { useIssue } from '@/hooks/use-kanban'
import { getIssueUrl } from '@/stores/server-store'

interface IssuePanelProps {
  projectId: string
  issueId?: string | null
  onClose: () => void
  hideHeaderActions?: boolean
}

export function IssuePanel({ projectId, issueId, onClose, hideHeaderActions }: IssuePanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [copied, setCopied] = useState(false)

  const { data: issue } = useIssue(projectId, issueId ?? '')
  const effectiveIssue = issue

  // Auto-focus panel on mount
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      const target = e.target as HTMLElement
      const isEditable =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (isEditable) {
        target.blur()
        e.stopPropagation()
      } else {
        onClose()
      }
    }
  }

  const handleCopyLink = () => {
    if (!issueId) return
    navigator.clipboard
      .writeText(getIssueUrl(projectId, issueId))
      .then(() => {
        setCopied(true)
        setTimeout(setCopied, 2000, false)
      })
      .catch(() => {})
  }

  return (
    <div
      ref={panelRef}
      className="relative flex flex-col h-full overflow-hidden bg-card outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2.5 border-b border-border/60 shrink-0 min-h-[45px] bg-background/80 backdrop-blur-sm">
        <IssueTitle projectId={projectId} issue={effectiveIssue} />
        <div className="flex items-center gap-0.5 shrink-0">
          {!hideHeaderActions ?
              (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 transition-all duration-200 ${copied ? 'text-emerald-500 scale-110' : 'text-muted-foreground hover:text-foreground'}`}
                    title={t('issue.copyLink')}
                    onClick={handleCopyLink}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Link className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
                    title={t('issue.openFullPage')}
                    onClick={() => {
                      void navigate(`/projects/${projectId}/issues/${issueId}`)
                      onClose()
                    }}
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) :
            null}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
            title={t('issue.closePanel')}
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Shared chat body: messages + metadata bar + input */}
      {effectiveIssue && issueId ?
          (
            <ChatBody
              projectId={projectId}
              issueId={issueId}
              issue={effectiveIssue}
              scrollRef={scrollRef}
              onAfterDelete={onClose}
            />
          ) :
        null}

    </div>
  )
}
