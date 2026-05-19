import { CheckCircle2, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { eventBus } from '@/lib/event-bus'

/**
 * Global review notification hook.
 *
 * Listens to SSE 'issue-updated' events. When an issue's status changes to
 * 'review', shows a compact toast. Clicking the body navigates; the × dismisses.
 * Auto-dismisses after 12s so the feed doesn't pile up and block the view.
 */
export function useReviewNotifications() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const notifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unsubscribe = eventBus.onIssueUpdated((data) => {
      if (data.changes.statusId !== 'review') return
      if (data.source === 'user') return
      if (notifiedRef.current.has(data.issueId)) return

      notifiedRef.current.add(data.issueId)
      const title = data.title || `#${data.issueId.slice(0, 8)}`
      const project = data.projectAlias || ''
      const hasAlias = !!data.projectAlias
      const issueUrl = hasAlias
        ? `/review/${data.projectAlias}/${data.issueId}`
        : '/review'

      const toastId = toast.custom(
        () => (
          <div
            data-testid="review-notification"
            role="button"
            tabIndex={0}
            onClick={() => {
              toast.dismiss(toastId)
              navigate(issueUrl)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toast.dismiss(toastId)
                navigate(issueUrl)
              }
            }}
            className="flex items-center gap-2 w-[min(280px,calc(100vw-2rem))] bg-popover/90 backdrop-blur-md text-popover-foreground pl-2.5 pr-1 py-1.5 rounded-lg border border-border/50 shadow-lg cursor-pointer hover:bg-accent/60 transition-colors"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
            <div className="flex-1 min-w-0 text-[11px] leading-tight">
              <span className="font-medium">{t('review.newIssueShort', '待审核')}</span>
              <span className="text-muted-foreground/80 ml-1.5 truncate">
                {project ? `${project} · ${title}` : title}
              </span>
            </div>
            <button
              type="button"
              aria-label={t('review.ignore', '忽略')}
              data-testid="review-notification-dismiss"
              onClick={(e) => {
                e.stopPropagation()
                toast.dismiss(toastId)
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent shrink-0 cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ),
        { duration: 12000 },
      )
    })

    return unsubscribe
  }, [t, navigate])
}
