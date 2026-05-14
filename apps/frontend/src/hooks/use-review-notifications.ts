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
 * dismisses it or navigates to review. Deduplicates within the session.
 */
export function useReviewNotifications() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const notifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unsubscribe = eventBus.onIssueUpdated((data) => {
      if (data.changes.statusId !== 'review') return
      if (notifiedRef.current.has(data.issueId)) return

      notifiedRef.current.add(data.issueId)
      const toastId = toast.info(
        t('review.newIssue', '有 issue 已完成，待审核'),
        {
          description: `#${data.issueId.slice(0, 8)}`,
          duration: Infinity,
          action: {
            label: t('review.view', '查看'),
            onClick: () => {
              toast.dismiss(toastId)
              void navigate('/review')
            },
          },
          cancel: {
            label: t('review.ignore', '忽略'),
            onClick: () => {
              toast.dismiss(toastId)
            },
          },
        },
      )
    })

    return unsubscribe
  }, [t, navigate])
}
