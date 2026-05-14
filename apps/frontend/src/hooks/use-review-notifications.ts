import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { eventBus } from '@/lib/event-bus'

/**
 * Global review notification hook.
 *
 * Listens to SSE 'issue-updated' events. When an issue's status changes to
 * 'review', shows a toast notification. Deduplicates within the session so
 * the same issue doesn't spam the user.
 *
 * This hook is intentionally passive — it does NOT auto-navigate. The user
 * sees the toast, then uses Cmd+K or the sidebar to go to the Review page.
 */
export function useReviewNotifications() {
  const { t } = useTranslation()
  const notifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unsubscribe = eventBus.onIssueUpdated((data) => {
      if (data.changes.statusId !== 'review') return
      if (notifiedRef.current.has(data.issueId)) return

      notifiedRef.current.add(data.issueId)
      toast.info(t('review.newIssue', '有 issue 已完成，待审核'), {
        description: `#${data.issueId.slice(0, 8)}`,
        duration: 5000,
      })
    })

    return unsubscribe
  }, [t])
}
