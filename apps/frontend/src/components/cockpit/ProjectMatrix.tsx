import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useIssueStats } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'

const STATUSES = ['todo', 'working', 'review', 'done'] as const
type Status = typeof STATUSES[number]

const STATUS_COLOR: Record<Status, string> = {
  todo: '#6b7280',
  working: '#3b82f6',
  review: '#f59e0b',
  done: '#22c55e',
}

export const ProjectMatrix = memo(() => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const { data, isLoading } = useIssueStats()

  if (isLoading && !data) {
    return (
      <div
        data-testid="cockpit-matrix-loading"
        className="flex items-center justify-center py-6 text-xs text-muted-foreground/60"
      >
        {t('common.loading', 'Loading...')}
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div
        data-testid="cockpit-matrix-empty"
        className="flex items-center justify-center py-6 text-xs text-muted-foreground/60"
      >
        {t('cockpit.matrix.empty', 'No projects yet')}
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-2">
        {data.map(p => (
          <button
            key={p.projectId}
            type="button"
            data-testid={`cockpit-matrix-mobile-card-${p.projectId}`}
            onClick={() => navigate(`/projects/${p.projectAlias}`)}
            className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/50 p-3 text-left active:bg-accent/50 transition-colors min-h-[44px] cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-foreground/90 text-sm">{p.projectName}</span>
              <span className="text-xs font-semibold tabular-nums text-foreground/70">{p.total}</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {STATUSES.map((s) => {
                const n = p.counts[s]
                return (
                  <div
                    key={s}
                    data-testid={`cell-${s}`}
                    className="flex flex-col items-center gap-0.5 rounded-md bg-background/60 px-1 py-1.5"
                    style={{ opacity: n > 0 ? 1 : 0.45 }}
                  >
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: STATUS_COLOR[s] }}
                    >
                      {n}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {t(`statusName.${s.charAt(0).toUpperCase()}${s.slice(1)}`, s)}
                    </span>
                  </div>
                )
              })}
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden">
      <div className="grid grid-cols-[1fr_repeat(4,minmax(48px,72px))_64px] items-center gap-x-2 px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground/60 border-b border-border/50 bg-secondary/40">
        <div>{t('cockpit.matrix.project', 'Project')}</div>
        {STATUSES.map(s => (
          <div key={s} className="text-right tabular-nums">
            {t(`statusName.${s.charAt(0).toUpperCase()}${s.slice(1)}`, s)}
          </div>
        ))}
        <div className="text-right tabular-nums">{t('cockpit.matrix.total', 'Total')}</div>
      </div>
      <div>
        {data.map(p => (
          <div
            key={p.projectId}
            data-testid={`cockpit-matrix-row-${p.projectId}`}
            className="grid grid-cols-[1fr_repeat(4,minmax(48px,72px))_64px] items-center gap-x-2 px-3 py-2 text-sm border-b border-border/30 last:border-b-0 hover:bg-accent/40 transition-colors"
          >
            <button
              type="button"
              onClick={() => navigate(`/projects/${p.projectAlias}`)}
              className="text-left truncate font-medium text-foreground/90 hover:text-primary cursor-pointer"
              title={p.projectName}
            >
              {p.projectName}
            </button>
            {STATUSES.map((s) => {
              const n = p.counts[s]
              return (
                <button
                  key={s}
                  type="button"
                  data-testid={`cell-${s}`}
                  onClick={() => navigate(`/projects/${p.projectAlias}?status=${s}`)}
                  className="text-right tabular-nums text-xs cursor-pointer rounded px-1.5 py-0.5 hover:bg-background transition-colors"
                  style={{
                    color: n > 0 ? STATUS_COLOR[s] : 'var(--muted-foreground)',
                    opacity: n > 0 ? 1 : 0.4,
                  }}
                  aria-label={`${p.projectName} ${s} ${n}`}
                >
                  {n}
                </button>
              )
            })}
            <div className="text-right tabular-nums text-xs font-semibold text-foreground/80">
              {p.total}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
})

ProjectMatrix.displayName = 'ProjectMatrix'
