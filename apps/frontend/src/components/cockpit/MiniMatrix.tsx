import { ChevronUp, LayoutGrid } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useIssueStats } from '@/hooks/use-kanban'
import { useViewModeStore } from '@/stores/view-mode-store'

const STATUSES = ['todo', 'working', 'review', 'done'] as const
type Status = typeof STATUSES[number]

const STATUS_COLOR: Record<Status, string> = {
  todo: '#6b7280',
  working: '#3b82f6',
  review: '#f59e0b',
  done: '#22c55e',
}

/**
 * Compact (project × status) overview anchored to the upper-right of the chat
 * area when an issue is open. Lets the user "望一眼全局" without leaving the
 * current issue. Collapsible via the global toggle in view-mode-store so the
 * user can hide it permanently if they find it noisy.
 */
export const MiniMatrix = memo(() => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data } = useIssueStats()
  const collapsed = useViewModeStore(s => s.miniMatrixCollapsed)
  const toggle = useViewModeStore(s => s.toggleMiniMatrix)

  if (!data || data.length === 0) return null

  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="mini-matrix-collapsed"
        onClick={toggle}
        title={t('cockpit.miniMatrix.expand', 'Show overview')}
        aria-label={t('cockpit.miniMatrix.expand', 'Show overview')}
        className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-card/90 text-muted-foreground border border-border/60 shadow-sm hover:bg-accent transition-colors cursor-pointer"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>
    )
  }

  return (
    <div
      data-testid="mini-matrix"
      className="absolute right-4 top-4 z-20 w-[200px] max-h-[60vh] overflow-y-auto rounded-lg border border-border/60 bg-card/95 backdrop-blur-sm shadow-md"
    >
      <header className="flex items-center justify-between gap-1 border-b border-border/40 px-2 py-1.5">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/80">
          {t('cockpit.miniMatrix.title', 'Overview')}
        </span>
        <button
          type="button"
          data-testid="mini-matrix-collapse"
          onClick={toggle}
          aria-label={t('cockpit.miniMatrix.collapse', 'Collapse overview')}
          title={t('cockpit.miniMatrix.collapse', 'Collapse overview')}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
      </header>
      <ul className="flex flex-col">
        {data.map(p => (
          <li
            key={p.projectId}
            data-testid={`mini-matrix-row-${p.projectId}`}
            className="flex flex-col gap-0.5 px-2 py-1.5 border-b border-border/30 last:border-b-0"
          >
            <button
              type="button"
              onClick={() => navigate(`/projects/${p.projectAlias}`)}
              className="text-[11px] truncate text-foreground/85 hover:text-primary text-left cursor-pointer"
              title={p.projectName}
            >
              {p.projectName}
            </button>
            <div className="flex items-center justify-between gap-0.5">
              {STATUSES.map((s) => {
                const n = p.counts[s]
                return (
                  <button
                    key={s}
                    type="button"
                    data-testid={`mini-matrix-cell-${p.projectId}-${s}`}
                    onClick={() => navigate(`/projects/${p.projectAlias}?status=${s}`)}
                    className="flex-1 rounded px-1 py-0.5 text-[10px] font-mono tabular-nums hover:bg-accent transition-colors cursor-pointer"
                    style={{
                      color: n > 0 ? STATUS_COLOR[s] : 'var(--muted-foreground)',
                      opacity: n > 0 ? 1 : 0.4,
                    }}
                    title={`${p.projectName} ${s} ${n}`}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
})

MiniMatrix.displayName = 'MiniMatrix'

export function MiniMatrixExpandTrigger() {
  // Re-export the collapse-state-respecting expand entry, used by the TopBar
  // ⊞ button to programmatically toggle from outside the matrix container.
  const toggle = useViewModeStore(s => s.toggleMiniMatrix)
  const collapsed = useViewModeStore(s => s.miniMatrixCollapsed)
  return { toggle, collapsed }
}
