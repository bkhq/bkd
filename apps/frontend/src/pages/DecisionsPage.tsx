import type { DecisionEvent, DecisionEventStatus } from '@bkd/shared'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { DecisionEventCard } from '@/components/decisions/DecisionEventCard'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useCloseDecisionEvent,
  useDecideDecisionEvent,
  useDecisionEvents,
  useNotifyDecisionEvent,
} from '@/hooks/use-decision-events'
import { useIsMobile } from '@/hooks/use-mobile'

type Group = 'waiting' | 'decided' | 'history'

const ALL_CAMPAIGNS = 'all'

const GROUPS: Record<Group, DecisionEventStatus[]> = {
  waiting: ['open'],
  decided: ['decided'],
  history: ['applied', 'withdrawn', 'closed'],
}

export default function DecisionsPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { data: events, isLoading } = useDecisionEvents()
  const decide = useDecideDecisionEvent()
  const close = useCloseDecisionEvent()
  const notify = useNotifyDecisionEvent()
  const [group, setGroup] = useState<Group>('waiting')
  const [campaign, setCampaign] = useState(ALL_CAMPAIGNS)
  const [closeTarget, setCloseTarget] = useState<DecisionEvent | null>(null)
  const [closeReason, setCloseReason] = useState('')

  const campaigns = useMemo(
    () => [...new Set((events ?? []).map(e => e.campaignId))].sort(),
    [events],
  )

  const grouped = useMemo(() => {
    const inCampaign = (events ?? []).filter(
      e => campaign === ALL_CAMPAIGNS || e.campaignId === campaign,
    )
    const by = (g: Group) => inCampaign.filter(e => GROUPS[g].includes(e.status))
    return {
      // The longest-waiting question comes first; settled ones newest first.
      waiting: by('waiting').reverse(),
      decided: by('decided'),
      history: by('history'),
    }
  }, [events, campaign])

  const visible = grouped[group]
  const error = decide.error ?? notify.error

  const requestClose = (event: DecisionEvent) => {
    close.reset()
    setCloseReason('')
    setCloseTarget(event)
  }

  const confirmClose = () => {
    if (!closeTarget) return
    close.mutate(
      { id: closeTarget.id, reason: closeReason.trim() || undefined },
      { onSuccess: () => setCloseTarget(null) },
    )
  }

  return (
    <div className="flex h-full text-foreground overflow-hidden animate-page-enter">
      {!isMobile ? <AppSidebar activeProjectId="" /> : null}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <section className="mx-auto max-w-3xl px-4 py-4 md:px-6 md:py-8">
          <div className="mb-4 flex items-center gap-2.5 md:mb-6">
            {isMobile ? <MobileSidebar activeProjectId="" /> : null}
            <Link to="/" aria-label={t('sidebar.home')}>
              <AppLogo className="h-8 w-8" />
            </Link>
            <h1 className="text-lg font-semibold tracking-tight md:text-xl">
              {t('decisions.title')}
            </h1>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Tabs value={group} onValueChange={value => setGroup(value as Group)}>
              <TabsList>
                {(Object.keys(GROUPS) as Group[]).map(g => (
                  <TabsTrigger key={g} value={g} className="gap-1.5 px-3">
                    {t(`decisions.group.${g}`)}
                    <Badge variant="secondary">{grouped[g].length}</Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {campaigns.length > 1 ?
                (
                  <Select value={campaign} onValueChange={value => setCampaign(value ?? ALL_CAMPAIGNS)}>
                    <SelectTrigger className="ml-auto w-[180px]" aria-label={t('decisions.campaign')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_CAMPAIGNS}>{t('decisions.allCampaigns')}</SelectItem>
                      {campaigns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) :
              null}
          </div>

          {error ?
              <p role="alert" className="mb-3 text-sm text-destructive">{error.message}</p> :
            null}

          {isLoading ?
              <div className="h-32 rounded-lg border bg-card/30 animate-pulse" /> :
            visible.length === 0 ?
                (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    {t(`decisions.empty.${group}`)}
                  </p>
                ) :
                (
                  <div className="space-y-3">
                    {visible.map(event => (
                      <DecisionEventCard
                        key={event.id}
                        event={event}
                        pending={decide.isPending || notify.isPending}
                        onDecide={data => decide.mutate({ id: event.id, ...data })}
                        onClose={() => requestClose(event)}
                        onResend={() => notify.mutate(event.id)}
                      />
                    ))}
                  </div>
                )}

          <AlertDialog
            open={!!closeTarget}
            onOpenChange={(open) => {
              if (!open && !close.isPending) setCloseTarget(null)
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('decisions.closeConfirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('decisions.closeConfirm')}</AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={closeReason}
                onChange={e => setCloseReason(e.target.value)}
                placeholder={t('decisions.closeReasonPlaceholder')}
                aria-label={t('decisions.closeReason')}
                maxLength={2000}
              />
              {close.error ?
                  <p role="alert" className="text-sm text-destructive">{close.error.message}</p> :
                null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={close.isPending}>
                  {t('common.cancel')}
                </AlertDialogCancel>
                <AlertDialogAction disabled={close.isPending} onClick={confirmClose}>
                  {t('decisions.close')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </main>
    </div>
  )
}
