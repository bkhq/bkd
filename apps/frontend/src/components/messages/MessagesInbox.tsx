import type { Message, MessageKind, MessageStatus } from '@bkd/shared'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useCloseMessage,
  useDecideMessage,
  useMessages,
  useNotifyMessage,
  useReadAllMessages,
  useReadMessage,
  useReplyMessage,
} from '@/hooks/use-messages'
import { DecisionCard } from './DecisionCard'
import { NotificationCard } from './NotificationCard'

type Group = 'waiting' | 'answered' | 'history'

const ALL = 'all'

const GROUPS: Record<Group, MessageStatus[]> = {
  waiting: ['open', 'unread'],
  answered: ['decided', 'replied'],
  history: ['applied', 'withdrawn', 'closed', 'read'],
}

const KINDS: MessageKind[] = ['decision', 'notification']

export function MessagesInbox() {
  const { t } = useTranslation()
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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-3">
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
              <SelectTrigger size="sm" className="w-[150px]" aria-label={t('messages.kind.label')}>
                <SelectValue>{(value: string | null) => t(`messages.kind.${value ?? ALL}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {[ALL, ...KINDS].map(k => <SelectItem key={k} value={k}>{t(`messages.kind.${k}`)}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
            {campaigns.length > 1 ?
                (
                  <Select value={campaign} onValueChange={value => setCampaign(value ?? ALL)}>
                    <SelectTrigger size="sm" className="w-[180px]" aria-label={t('decisions.campaign')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={ALL}>{t('decisions.allCampaigns')}</SelectItem>
                        {campaigns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectGroup>
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
      </div>
    </div>
  )
}
