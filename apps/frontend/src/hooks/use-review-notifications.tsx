import { Info } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { eventBus } from '@/lib/event-bus'

/**
 * Global review notification hook.
 *
 * Listens to SSE 'issue-updated' events. When an issue's status changes to
 * 'review', shows a persistent toast notification that stays until the user
 * dismisses it or navigates to the issue. Deduplicates within the session.
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
      // Only build a per-issue URL when projectAlias is present and non-empty.
      const hasAlias = !!data.projectAlias
      const issueUrl = hasAlias
        ? `/review/${data.projectAlias}/${data.issueId}`
        : '/review'

      const toastId = toast.custom(
        () => (
          <div className="group flex gap-2.5 sm:gap-3 w-[min(320px,calc(100vw-2rem))] bg-popover/80 backdrop-blur-md text-popover-foreground p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-border/50 shadow-xl sm:shadow-2xl">
            <div className="shrink-0 mt-0.5">
              <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg sm:rounded-xl bg-primary/10">
                <Info className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs sm:text-[13px] font-semibold leading-tight">
                {t('review.newIssue', '有 issue 已完成，待审核')}
              </div>
              <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 truncate group-hover:whitespace-normal group-hover:overflow-visible transition-all">
                {project ? `${project} / ${title}` : title}
              </div>
              <div className="flex gap-2 mt-2 sm:mt-3">
                {/* Use <a> so the browser always navigates even if navigate()
                    fails inside the toast portal. navigate() provides SPA
                    routing when it works; the href is a hard fallback. */}
                <a
                  href={issueUrl}
                  onClick={(e) => {
                    e.stopPropagation()
                    toast.dismiss(toastId)
                    navigate(issueUrl)
                  }}
                  className="inline-flex items-center justify-center rounded-md sm:rounded-lg bg-primary px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer no-underline"
                >
                  {t('review.view', '查看')}
                </a>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-md sm:rounded-lg px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
                  onClick={() => toast.dismiss(toastId)}
                >
                  {t('review.ignore', '忽略')}
                </button>
              </div>
            </div>
          </div>
        ),
        { duration: Infinity },
      )
    })

    return unsubscribe
  }, [t, navigate])
}
