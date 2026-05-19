import { ChevronDown, LayoutGrid } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AssistantFab } from './AssistantFab'
import { BotTimeline } from './BotTimeline'

const ProjectMatrix = lazy(() =>
  import('./ProjectMatrix').then(m => ({ default: m.ProjectMatrix })),
)
const ActivityStream = lazy(() =>
  import('./ActivityStream').then(m => ({ default: m.ActivityStream })),
)

export function CockpitDashboard() {
  const { t } = useTranslation()
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold tracking-tight">
            {t('cockpit.title', 'Cockpit')}
          </h1>
        </div>
      </div>

      {/* Always-on bot timeline (replaces matrix + stream as primary view) */}
      <BotTimeline />

      {/* Raw activity stays reachable but does not subscribe to SSE while
          closed — lazy-mount keeps the always-on screen quiet. */}
      <div className="px-5 pb-6 max-w-3xl w-full mx-auto">
        <button
          type="button"
          onClick={() => setShowRaw(v => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform ${showRaw ? 'rotate-180' : ''}`}
          />
          {showRaw ?
              t('cockpit.timeline.hideRaw', 'Hide raw activity') :
              t('cockpit.timeline.showRaw', 'Show raw activity')}
        </button>
        {showRaw && (
          <Suspense
            fallback={(
              <div className="mt-4 text-xs text-muted-foreground">
                {t('common.loading', 'Loading...')}
              </div>
            )}
          >
            <div className="mt-4 flex flex-col gap-5">
              <section className="flex flex-col gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                  {t('cockpit.matrix.title', 'Projects overview')}
                </h2>
                <ProjectMatrix />
              </section>
              <section className="flex flex-col gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                  {t('cockpit.activity.title', 'Recent activity')}
                </h2>
                <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden">
                  <ActivityStream />
                </div>
              </section>
            </div>
          </Suspense>
        )}
      </div>

      <AssistantFab />
    </div>
  )
}
