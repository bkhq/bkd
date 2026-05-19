import { Activity, LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ActivityStream } from './ActivityStream'
import { AssistantFab } from './AssistantFab'
import { CockpitQuickCreate } from './CockpitQuickCreate'
import { ProjectMatrix } from './ProjectMatrix'

export function CockpitDashboard() {
  const { t } = useTranslation()

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
        <CockpitQuickCreate />
      </div>

      <div className="flex flex-col gap-5 p-5 max-w-5xl w-full mx-auto">
        {/* Matrix */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
            <LayoutGrid className="h-3 w-3" />
            {t('cockpit.matrix.title', 'Projects overview')}
          </h2>
          <ProjectMatrix />
        </section>

        {/* Activity */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
            <Activity className="h-3 w-3" />
            {t('cockpit.activity.title', 'Recent activity')}
          </h2>
          <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden">
            <ActivityStream />
          </div>
        </section>
      </div>

      <AssistantFab />
    </div>
  )
}
