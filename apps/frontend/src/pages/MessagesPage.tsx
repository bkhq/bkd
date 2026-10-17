import type { Message, MessageKind, MessageStatus } from '@bkd/shared'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { AppLogo } from '@/components/AppLogo'
import { AppSidebar } from '@/components/kanban/AppSidebar'
import { MobileSidebar } from '@/components/kanban/MobileSidebar'
import { DecisionCard } from '@/components/messages/DecisionCard'
import { NotificationCard } from '@/components/messages/NotificationCard'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  useCloseMessage,
  useDecideMessage,
  useMessages,
  useNotifyMessage,
  useReadAllMessages,
  useReadMessage,
  useReplyMessage,
} from '@/hooks/use-messages'

type Group = 'waiting' | 'answered' | 'history'

const ALL = 'all'

const GROUPS: Record<Group, MessageStatus[]> = {
  waiting: ['open', 'unread'],
  answered: ['decided', 'replied'],
  history: ['applied', 'withdrawn', 'closed', 'read'],
}

const KINDS: MessageKind[] = ['decision', 'notification']

export default function MessagesPage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const { data: events, isLoading } = useMessages()
  const decide = useDecideMessage()
  const reply = useReplyMessage()
  const close = useCloseMessage()
  const notify = useNotifyMessage()
  const read = useReadMessage()
  const readAll = useReadAllMessages()
  const [group, setGroup] = useState<Group>('waiting')
  const [kind, setKind] = useState<MessageKind | typeof ALL>(ALL)
  const [campaign, setCampaign] = useState(ALL)
  const [closeTarget, setCloseTarget] = useState<Message | null>(null)
  const [closeReason, setCloseReason] = useState('')

  const campaigns = useMemo(
    () => [...new Set((events ?? []).flatMap(e => (e.campaignId ? [e.campaignId] : [])))].sort(),
    [events],
  )

  const grouped = useMemo(() => {
    const matching = (events ?? []).filter(
      e => (campaign === ALL || e.campaignId === campaign) && (kind === ALL || e.kind === kind),
    )
    const by = (g: Group) => matching.filter(e => GROUPS[g].includes(e.status))
    return {
      // The longest-waiting message comes first; settled ones newest first.
      waiting: by('waiting').reverse(),
      answered: by('answered'),
      history: by('history'),
    }
  }, [events, campaign, kind])

  const visible = grouped[group]
  const hasUnread = (events ?? []).some(e => e.status === 'unread')
  const error = decide.error ?? reply.error ?? notify.error ?? read.error ?? readAll.error
  const pending = decide.isPending || reply.isPending || notify.isPending || read.isPending

  const requestClose = (event: Message) => {
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
              {t('messages.title')}
            </h1>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Tabs value={group} onValueChange={value => setGroup(value as Group)}>
              <TabsList>
                {(Object.keys(GROUPS) as Group[]).map(g => (
                  <TabsTrigger key={g} value={g} className="gap-1.5 px-3">
                    {t(`messages.group.${g}`)}
                    <Badge variant="secondary">{grouped[g].length}</Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {hasUnread ?
                  (
                    <Button variant="outline" size="sm" disabled={readAll.isPending} onClick={() => readAll.mutate()}>
                      {t('messages.markAllRead')}
                    </Button>
                  ) :
                null}
              <Select
                value={kind}
                onValueChange={value => setKind((value ?? ALL) as MessageKind | typeof ALL)}
              >
                <SelectTrigger className="w-[150px]" aria-label={t('messages.kind.label')}>
                  <SelectValue>{(value: string | null) => t(`messages.kind.${value ?? ALL}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {[ALL, ...KINDS].map(k => <SelectItem key={k} value={k}>{t(`messages.kind.${k}`)}</SelectItem>)}
                </SelectContent>
              </Select>
              {campaigns.length > 1 ?
                  (
                    <Select value={campaign} onValueChange={value => setCampaign(value ?? ALL)}>
                      <SelectTrigger className="w-[180px]" aria-label={t('decisions.campaign')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>{t('decisions.allCampaigns')}</SelectItem>
                        {campaigns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) :
                null}
            </div>
          </div>

          {error ?
              <p role="alert" className="mb-3 text-sm text-destructive">{error.message}</p> :
            null}

          {isLoading ?
              <div className="h-32 rounded-lg border bg-card/30 animate-pulse" /> :
            visible.length === 0 ?
                (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    {t(`messages.empty.${group}`)}
                  </p>
                ) :
                (
                  <div className="space-y-3">
                    {visible.map(event => event.kind === 'decision' ?
                        (
                          <DecisionCard
                            key={event.id}
                            event={event}
                            pending={pending}
                            onDecide={data => decide.mutate({ id: event.id, ...data })}
                            onClose={() => requestClose(event)}
                            onResend={() => notify.mutate(event.id)}
                          />
                        ) :
                        (
                          <NotificationCard
                            key={event.id}
                            message={event}
                            pending={pending}
                            onRead={() => read.mutate(event.id)}
                            onReply={text => reply.mutate({ id: event.id, text })}
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
                <AlertDialogTitle>{t('messages.closeConfirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('messages.closeConfirm')}</AlertDialogDescription>
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
