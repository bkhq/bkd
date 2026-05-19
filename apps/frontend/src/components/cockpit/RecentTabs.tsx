import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { removeRecentIssue, useRecentIssues } from '@/hooks/use-recent-issues'
import { usePanelStore } from '@/stores/panel-store'

const MAX_VISIBLE = 5

const STATUS_DOT_COLOR: Record<string, string> = {
  todo: '#6b7280',
  working: '#3b82f6',
  review: '#f59e0b',
  done: '#22c55e',
}

/**
 * Horizontal strip of the most recent issues the user has visited. Clicking a
 * tab navigates back to that issue inside the cockpit (`/review/...`). The ×
 * removes the entry from the recent-issues store without touching the issue
 * itself.
 *
 * Hidden when the recent-issues store is empty; opening QuickCreate is left
 * to the TopBar's + button, but a + at the end of the strip also makes the
 * "create something new" affordance reachable when several tabs are shown.
 */
export function RecentTabs() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { issueId: activeIssueId } = useParams<{ issueId: string }>()
  const recent = useRecentIssues()
  const openCreate = usePanelStore(s => s.openCreateDialog)

  if (recent.length === 0) return null

  const visible = recent.slice(0, MAX_VISIBLE)

  return (
    <div
      data-testid="recent-tabs"
      className="flex items-center gap-1 overflow-x-auto no-scrollbar border-b border-border/40 bg-background/60 px-2 py-1 shrink-0"
    >
      {visible.map((tab) => {
        const isActive = tab.id === activeIssueId
        return (
          <div
            key={tab.id}
            data-testid={`recent-tab-${tab.id}`}
            data-active={isActive ? 'true' : 'false'}
            className={`group inline-flex items-center gap-1 shrink-0 max-w-[200px] rounded-md border px-2 py-1 text-xs transition-colors ${
              isActive ?
                'border-primary/40 bg-primary/[0.08] text-foreground' :
                'border-transparent hover:bg-accent text-muted-foreground'
            }`}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: STATUS_DOT_COLOR[tab.statusId] ?? '#9ca3af' }}
              title={tab.statusId}
            />
            <button
              type="button"
              onClick={() => navigate(`/review/${tab.projectAlias}/${tab.id}`)}
              className="truncate cursor-pointer"
              title={`${tab.projectAlias} · ${tab.title}`}
            >
              <span className="font-mono tabular-nums text-muted-foreground/70 mr-1">
                #
                {tab.issueNumber}
              </span>
              <span className="text-foreground/90">{tab.title}</span>
            </button>
            <button
              type="button"
              data-testid={`recent-tab-close-${tab.id}`}
              onClick={(e) => {
                e.stopPropagation()
                removeRecentIssue(tab.id)
              }}
              aria-label={t('cockpit.recentTabs.close', 'Close tab')}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all cursor-pointer"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        data-testid="recent-tabs-new"
        onClick={() => openCreate()}
        aria-label={t('cockpit.recentTabs.new', 'New issue')}
        title={t('cockpit.recentTabs.new', 'New issue')}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors cursor-pointer shrink-0"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
