import type { ClaudeUsage, ClaudeUsageWindow } from '@bkd/shared'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useClaudeUsage } from '@/hooks/use-kanban'
import { cn } from '@/lib/utils'

const REASON_KEYS: Record<NonNullable<ClaudeUsage['reason']>, string> = {
  no_credentials: 'settings.usageUnavailableNoCredentials',
  api_key_mode: 'settings.usageUnavailableApiKey',
  token_expired: 'settings.usageUnavailableTokenExpired',
  upstream_error: 'settings.usageUnavailableUpstream',
}

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-destructive'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-primary'
}

function UsageBar({ label, window: w }: { label: string, window: ClaudeUsageWindow }) {
  const { t } = useTranslation()
  const pct = Math.max(0, Math.min(100, w.usedPercentage))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {Math.round(pct)}
          %
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', barColor(pct))} style={{ width: `${pct}%` }} />
      </div>
      {w.resetsAt ?
          (
            <p className="text-[11px] text-muted-foreground">
              {t('settings.usageResetsAt', { time: new Date(w.resetsAt).toLocaleString() })}
            </p>
          ) :
        null}
    </div>
  )
}

export function UsageSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data, isLoading, isError, isFetching, refetch } = useClaudeUsage(open)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t('settings.usageLoading')}
      </div>
    )
  }

  if (isError || !data) {
    return <div className="py-4 text-sm text-muted-foreground">{t('settings.usageLoadError')}</div>
  }

  const modelWindows = data.modelWindows ?? []
  const hasWindows = data.available && (data.fiveHour || data.sevenDay || modelWindows.length > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium">{t('settings.usageTitle')}</h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
          {t('settings.usageRefresh')}
        </Button>
      </div>

      {!data.available ?
          (
            <div className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
              {t(data.reason ? REASON_KEYS[data.reason] : 'settings.usageUnavailableUpstream')}
            </div>
          ) :
          !hasWindows ?
              (
                <div className="rounded-md border px-3 py-3 text-sm text-muted-foreground">
                  {t('settings.usageNoWindowData')}
                </div>
              ) :
              (
                <div className="space-y-4 rounded-md border px-3 py-3">
                  {data.fiveHour ? <UsageBar label={t('settings.usageFiveHour')} window={data.fiveHour} /> : null}
                  {data.sevenDay ? <UsageBar label={t('settings.usageSevenDay')} window={data.sevenDay} /> : null}
                  {modelWindows.map(w => (
                    <UsageBar key={w.model} label={t('settings.usageSevenDayModel', { model: w.model })} window={w} />
                  ))}
                </div>
              )}
    </div>
  )
}
