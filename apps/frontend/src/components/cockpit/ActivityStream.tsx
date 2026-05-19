import { Activity } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { eventBus } from '@/lib/event-bus'
import { kanbanApi } from '@/lib/kanban-api'

const MAX_ITEMS = 30

interface ActivityItem {
  issueId: string
  title: string
  projectAlias: string
  sessionStatus?: string
  statusId?: string
  at: number
}

export const ActivityStream = memo(() => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [items, setItems] = useState<ActivityItem[]>([])

  // Backfill on mount — SSE only delivers live updates, so without this the
  // feed appears empty after every reload until something changes status.
  useEffect(() => {
    let cancelled = false
    kanbanApi.getCockpitRecentActivity(MAX_ITEMS).then((rows) => {
      if (cancelled) return
      const backfill: ActivityItem[] = rows.map(r => ({
        issueId: r.issueId,
        title: r.title,
        projectAlias: r.projectAlias,
        sessionStatus: r.sessionStatus ?? undefined,
        statusId: r.statusId,
        at: new Date(r.statusUpdatedAt).getTime(),
      }))
      setItems((prev) => {
        if (prev.length === 0) return backfill.slice(0, MAX_ITEMS)
        const seen = new Set(prev.map(p => p.issueId))
        const merged = [...prev, ...backfill.filter(b => !seen.has(b.issueId))]
        return merged.slice(0, MAX_ITEMS)
      })
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return eventBus.onIssueUpdated((data) => {
      if (!data.title || !data.projectAlias) return
      const next: ActivityItem = {
        issueId: data.issueId,
        title: data.title,
        projectAlias: data.projectAlias,
        sessionStatus: typeof data.changes?.sessionStatus === 'string' ?
          data.changes.sessionStatus :
          undefined,
        statusId: typeof data.changes?.statusId === 'string' ?
          data.changes.statusId :
          undefined,
        at: Date.now(),
      }
      setItems((prev) => {
        // dedupe: if head is same issue, replace it
        if (prev.length > 0 && prev[0].issueId === next.issueId) {
          return [next, ...prev.slice(1)]
        }
        const filtered = prev.filter(p => p.issueId !== next.issueId)
        return [next, ...filtered].slice(0, MAX_ITEMS)
      })
    })
  }, [])

  if (items.length === 0) {
    return (
      <div
        data-testid="cockpit-activity-empty"
        className="flex flex-col items-center justify-center gap-2 py-8 text-xs text-muted-foreground/60"
      >
        <Activity className="h-4 w-4 opacity-40" />
        <span>{t('cockpit.activity.empty', 'No recent activity')}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {items.map(item => (
        <button
          key={`${item.issueId}-${item.at}`}
          type="button"
          data-testid={`cockpit-activity-item-${item.issueId}`}
          onClick={() => navigate(`/review/${item.projectAlias}/${item.issueId}`)}
          className="flex items-center gap-2 px-3 py-2 text-left text-sm border-b border-border/30 last:border-b-0 hover:bg-accent/40 transition-colors cursor-pointer"
        >
          <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 truncate max-w-[80px]">
            {item.projectAlias}
          </span>
          <span className="truncate text-foreground/90 flex-1">{item.title}</span>
          {item.sessionStatus ?
              (
                <span className="text-[10px] font-medium text-muted-foreground/70 shrink-0 uppercase tracking-wide">
                  {item.sessionStatus}
                </span>
              ) :
            null}
          {item.statusId ?
              (
                <span className="text-[10px] font-medium text-primary/70 shrink-0 uppercase tracking-wide">
                  {item.statusId}
                </span>
              ) :
            null}
        </button>
      ))}
    </div>
  )
})

ActivityStream.displayName = 'ActivityStream'
