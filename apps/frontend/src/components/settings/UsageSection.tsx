import type { ClaudeUsage, ClaudeUsageWindow, CodexUsage, CodexUsageWindow } from '@bkd/shared'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EngineIcon } from '@/components/EngineIcons'
import { Button } from '@/components/ui/button'
import { useClaudeUsage, useCodexUsage } from '@/hooks/use-kanban'
import { cn } from '@/lib/utils'

const CLAUDE_REASON_KEYS: Record<NonNullable<ClaudeUsage['reason']>, string> = {
  no_credentials: 'settings.usageUnavailableNoCredentials',
  api_key_mode: 'settings.usageUnavailableApiKey',
  token_expired: 'settings.usageUnavailableTokenExpired',
  upstream_error: 'settings.usageUnavailableUpstream',
}

const CODEX_REASON_KEYS: Record<NonNullable<CodexUsage['reason']>, string> = {
  not_installed: 'settings.usageCodexUnavailableNotInstalled',
  unauthenticated: 'settings.usageCodexUnavailableUnauthenticated',
  unsupported: 'settings.usageCodexUnavailableUnsupported',
  upstream_error: 'settings.usageCodexUnavailableUpstream',
}

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-destructive'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-primary'
}

/** Label a Codex window by its length, e.g. 300 → "5-hour window". */
function windowLabel(t: TFunction, minutes: number | null): string {
  if (minutes === null || minutes <= 0) return t('settings.usageWindowUnknown')
  if (minutes % 1440 === 0) return t('settings.usageWindowDays', { n: minutes / 1440 })
  if (minutes % 60 === 0) return t('settings.usageWindowHours', { n: minutes / 60 })
  return t('settings.usageWindowMinutes', { n: minutes })
}

function UsageBar({ label, window: w }: { label: string, window: ClaudeUsageWindow | CodexUsageWindow }) {
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

function Notice({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 rounded-md border px-3 py-3 text-sm text-muted-foreground">{children}</div>
}

function EngineBlock({ engineType, label, children }: { engineType: string, label: string, children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <EngineIcon engineType={engineType} className="size-3.5" />
        {label}
      </div>
      {children}
    </div>
  )
}

interface BodyProps<T> {
  data: T | undefined
  isLoading: boolean
  isError: boolean
}

function ClaudeUsageBody({ data, isLoading, isError }: BodyProps<ClaudeUsage>) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <Notice>
        <Loader2 className="size-3.5 animate-spin" />
        {t('settings.usageLoading')}
      </Notice>
    )
  }
  if (isError || !data) return <Notice>{t('settings.usageLoadError')}</Notice>
  if (!data.available) {
    return <Notice>{t(data.reason ? CLAUDE_REASON_KEYS[data.reason] : 'settings.usageUnavailableUpstream')}</Notice>
  }

  const modelWindows = data.modelWindows ?? []
  if (!data.fiveHour && !data.sevenDay && modelWindows.length === 0) {
    return <Notice>{t('settings.usageNoWindowData')}</Notice>
  }

  return (
    <div className="space-y-4 rounded-md border px-3 py-3">
      {data.fiveHour ? <UsageBar label={t('settings.usageFiveHour')} window={data.fiveHour} /> : null}
      {data.sevenDay ? <UsageBar label={t('settings.usageSevenDay')} window={data.sevenDay} /> : null}
      {modelWindows.map(w => (
        <UsageBar key={w.model} label={t('settings.usageSevenDayModel', { model: w.model })} window={w} />
      ))}
    </div>
  )
}

function CodexUsageBody({ data, isLoading, isError }: BodyProps<CodexUsage>) {
  const { t } = useTranslation()

  if (isLoading) {
    return (
      <Notice>
        <Loader2 className="size-3.5 animate-spin" />
        {t('settings.usageLoading')}
      </Notice>
    )
  }
  if (isError || !data) return <Notice>{t('settings.usageLoadError')}</Notice>
  if (!data.available) {
    return <Notice>{t(data.reason ? CODEX_REASON_KEYS[data.reason] : 'settings.usageCodexUnavailableUpstream')}</Notice>
  }
  if (!data.primary && !data.secondary) return <Notice>{t('settings.usageNoWindowData')}</Notice>

  return (
    <div className="space-y-4 rounded-md border px-3 py-3">
      {data.planType ?
          <p className="text-[11px] text-muted-foreground">{t('settings.usagePlan', { plan: data.planType })}</p> :
        null}
      {data.primary ?
          <UsageBar label={windowLabel(t, data.primary.windowMinutes)} window={data.primary} /> :
        null}
      {data.secondary ?
          <UsageBar label={windowLabel(t, data.secondary.windowMinutes)} window={data.secondary} /> :
        null}
    </div>
  )
}

export function UsageSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const claude = useClaudeUsage(open)
  const codex = useCodexUsage(open)
  const isFetching = claude.isFetching || codex.isFetching

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium">{t('settings.usageTitle')}</h4>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => {
            claude.refetch()
            codex.refetch()
          }}
          disabled={isFetching}
        >
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
          {t('settings.usageRefresh')}
        </Button>
      </div>

      <EngineBlock engineType="claude-code" label={t('settings.usageEngineClaude')}>
        <ClaudeUsageBody data={claude.data} isLoading={claude.isLoading} isError={claude.isError} />
      </EngineBlock>

      <EngineBlock engineType="codex" label={t('settings.usageEngineCodex')}>
        <CodexUsageBody data={codex.data} isLoading={codex.isLoading} isError={codex.isError} />
      </EngineBlock>
    </div>
  )
}
