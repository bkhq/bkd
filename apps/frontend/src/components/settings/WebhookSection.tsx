import type { NotificationChannel, WebhookEventType } from '@bkd/shared'
import { WEBHOOK_EVENT_GROUPS, WEBHOOK_EVENT_TYPES } from '@bkd/shared'
import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  BotMessageSquare,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Globe,
  Loader2,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'
import { useCallback, useState } from 'react'
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
import { Card } from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useBrowserNotificationPermission } from '@/hooks/use-browser-notifications'
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from '@/hooks/use-kanban'
import { EVENT_LABEL_KEYS } from '@/lib/webhook-events'
import { cn } from 'cn'
import type { Webhook } from '@/types/kanban'
import { ScrollArea } from '@/components/ui/scroll-area'

const GROUP_LABEL_KEYS: Record<string, string> = {
  issue: 'settings.webhooksGroupIssue',
  status: 'settings.webhooksGroupStatus',
  session: 'settings.webhooksGroupSession',
  decision: 'settings.webhooksGroupDecision',
  message: 'settings.webhooksGroupMessage',
}

const CHANNELS: Record<NotificationChannel, { icon: LucideIcon, labelKey: string }> = {
  webhook: { icon: Globe, labelKey: 'settings.webhooksChannelWebhook' },
  telegram: { icon: BotMessageSquare, labelKey: 'settings.webhooksChannelTelegram' },
  browser: { icon: Bell, labelKey: 'settings.webhooksChannelBrowser' },
}

const CHANNEL_ORDER: NotificationChannel[] = ['webhook', 'telegram', 'browser']

export function WebhookSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const { data: webhooks, isLoading } = useWebhooks(open)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t('settings.webhooksHint')}</p>
        {!showForm && !editingId && (
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus data-icon="inline-start" />
            {t('settings.webhooksAdd')}
          </Button>
        )}
      </div>

      {showForm && <WebhookForm onClose={() => setShowForm(false)} />}

      {isLoading ?
          (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) :
        webhooks && webhooks.length > 0 ?
            (
              <div className="space-y-2">
                {webhooks.map(webhook =>
                  editingId === webhook.id ?
                      <WebhookForm key={webhook.id} webhook={webhook} onClose={() => setEditingId(null)} /> :
                      (
                        <WebhookCard
                          key={webhook.id}
                          webhook={webhook}
                          onEdit={() => setEditingId(webhook.id)}
                        />
                      ),
                )}
              </div>
            ) :
            !showForm ?
                (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {t('settings.webhooksEmpty')}
                  </div>
                ) :
              null}
    </div>
  )
}

function WebhookForm({ webhook, onClose }: { webhook?: Webhook, onClose: () => void }) {
  const { t } = useTranslation()
  const createWebhook = useCreateWebhook()
  const updateWebhook = useUpdateWebhook()

  const [channel, setChannel] = useState<NotificationChannel>(webhook?.channel ?? 'webhook')
  const [url, setUrl] = useState(webhook?.url ?? '')
  const [secret, setSecret] = useState(webhook?.secret ?? '')
  const [events, setEvents] = useState<WebhookEventType[]>(
    webhook?.events ?? [...WEBHOOK_EVENT_TYPES],
  )
  const [isActive, setIsActive] = useState(webhook?.isActive ?? true)
  const [interactive, setInteractive] = useState(webhook?.interactive ?? false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!webhook
  const isPending = createWebhook.isPending || updateWebhook.isPending
  const isTelegram = channel === 'telegram'
  const isBrowser = channel === 'browser'
  const isInteractive = isTelegram && interactive
  const hasNothingToSend = events.length === 0 && !isInteractive
  const isIncomplete = (!isBrowser && !url) || (isTelegram && !secret)

  const toggleEvent = useCallback((event: WebhookEventType) => {
    setEvents(prev => (prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]))
  }, [])

  const handleSubmit = () => {
    if (isIncomplete || hasNothingToSend) return
    setError(null)

    if (isEditing) {
      updateWebhook.mutate(
        {
          id: webhook.id,
          ...(!isBrowser && { url, secret: secret || null }),
          events,
          isActive,
          interactive: isInteractive,
        },
        {
          onSuccess: onClose,
          onError: err => setError(err.message),
        },
      )
    } else {
      createWebhook.mutate(
        { channel, url, secret: secret || undefined, events, isActive, interactive: isInteractive },
        {
          onSuccess: onClose,
          onError: err => setError(err.message),
        },
      )
    }
  }

  return (
    <Card className="gap-0 py-0">
      <FieldGroup className="gap-4 p-4">
        <Field>
          <FieldLabel>{t('settings.webhooksChannelType')}</FieldLabel>
          <Tabs value={channel} onValueChange={value => setChannel(value as NotificationChannel)}>
            <TabsList>
              {CHANNEL_ORDER.map((value) => {
                const { icon: Icon, labelKey } = CHANNELS[value]
                return (
                  <TabsTrigger key={value} value={value} disabled={isEditing && value !== channel} className="px-3">
                    <Icon />
                    {t(labelKey)}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </Field>

        {isBrowser && <BrowserPermissionField />}

        {isTelegram && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="webhook-bot-token">{t('settings.webhooksTelegramBotToken')}</FieldLabel>
                <Input
                  id="webhook-bot-token"
                  type="password"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder={t('settings.webhooksTelegramBotTokenPlaceholder')}
                />
                <FieldDescription className="text-xs">{t('settings.webhooksTelegramBotTokenHint')}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="webhook-chat-id">{t('settings.webhooksTelegramChatId')}</FieldLabel>
                <Input
                  id="webhook-chat-id"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder={t('settings.webhooksTelegramChatIdPlaceholder')}
                />
                <FieldDescription className="text-xs">{t('settings.webhooksTelegramChatIdHint')}</FieldDescription>
              </Field>
            </div>
            <Field orientation="horizontal">
              <Switch id="webhook-interactive" checked={interactive} onCheckedChange={setInteractive} />
              <FieldContent>
                <FieldLabel htmlFor="webhook-interactive">{t('settings.webhooksInteractive')}</FieldLabel>
                <FieldDescription className="text-xs">{t('settings.webhooksInteractiveHint')}</FieldDescription>
              </FieldContent>
            </Field>
          </>
        )}

        {channel === 'webhook' && (
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="webhook-url">{t('settings.webhooksUrl')}</FieldLabel>
              <Input
                id="webhook-url"
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder={t('settings.webhooksUrlPlaceholder')}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="webhook-secret">{t('settings.webhooksSecret')}</FieldLabel>
              <Input
                id="webhook-secret"
                type="password"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                placeholder={t('settings.webhooksSecretPlaceholder')}
              />
              <FieldDescription className="text-xs">{t('settings.webhooksSecretHint')}</FieldDescription>
            </Field>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">{t('settings.webhooksEvents')}</Label>
          <div className="space-y-2">
            {WEBHOOK_EVENT_GROUPS.map(group => (
              <div key={group.category}>
                <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">
                  {t(GROUP_LABEL_KEYS[group.category] ?? group.category)}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {group.events.map(event => (
                    <button
                      key={event}
                      type="button"
                      onClick={() => toggleEvent(event)}
                      className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors cursor-pointer',
                        events.includes(event) ?
                          'border-primary/30 bg-primary/10 text-primary' :
                          'border-border bg-muted/50 text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {events.includes(event) && <Check className="mr-1 size-3" />}
                      {t(EVENT_LABEL_KEYS[event])}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <FieldError>{error}</FieldError>}
      </FieldGroup>

      <div className="flex items-center justify-between gap-4 border-t bg-muted/30 px-4 py-3">
        <Field orientation="horizontal" className="w-auto">
          <Switch id="webhook-active" checked={isActive} onCheckedChange={setIsActive} />
          <FieldLabel htmlFor="webhook-active" className="font-normal">{t('settings.webhooksActive')}</FieldLabel>
        </Field>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('settings.webhooksCancel')}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={isIncomplete || hasNothingToSend || isPending}>
            {isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {isPending ?
              isEditing ?
                  t('settings.webhooksUpdating') :
                  t('settings.webhooksCreating') :
                t('settings.webhooksSave')}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function BrowserPermissionField() {
  const { t } = useTranslation()
  const { permission, request } = useBrowserNotificationPermission()

  return (
    <Field orientation="horizontal" className="rounded-lg border bg-muted/30 px-3 py-2.5">
      <FieldContent>
        <FieldLabel>{t(`settings.webhooksBrowserPermission.${permission}`)}</FieldLabel>
        <FieldDescription className="text-xs">{t('settings.webhooksBrowserHint')}</FieldDescription>
      </FieldContent>
      {permission === 'default' && (
        <Button variant="outline" size="sm" onClick={() => void request()}>
          {t('settings.webhooksBrowserAllow')}
        </Button>
      )}
    </Field>
  )
}

function WebhookCard({ webhook, onEdit }: { webhook: Webhook, onEdit: () => void }) {
  const { t } = useTranslation()
  const deleteWebhook = useDeleteWebhook()
  const updateWebhook = useUpdateWebhook()
  const testWebhook = useTestWebhook()
  const [isExpanded, setIsExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { icon: Icon, labelKey } = CHANNELS[webhook.channel] ?? CHANNELS.webhook
  const name =
    webhook.channel === 'browser' ?
        t(labelKey) :
      webhook.channel === 'telegram' ? `${t(labelKey)} · ${webhook.url}` : webhook.url
  const eventLabels = webhook.events.map(event => t(EVENT_LABEL_KEYS[event])).join(', ')

  return (
    <Card className={cn('gap-0 py-0', !webhook.isActive && 'opacity-70')}>
      <div className="flex items-center gap-3 p-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>

        <button type="button" onClick={onEdit} className="min-w-0 flex-1 cursor-pointer text-left">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-sm font-medium', webhook.channel === 'webhook' && 'font-mono')}>
              {name}
            </span>
            {webhook.interactive && (
              <Badge variant="secondary">{t('settings.webhooksInteractiveBadge')}</Badge>
            )}
            {!webhook.isActive && (
              <Badge variant="outline">{t('settings.webhooksDisabled')}</Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground" title={eventLabels}>
            {t('settings.webhooksEventCount', { count: webhook.events.length })}
            {eventLabels && ` · ${eventLabels}`}
          </p>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={webhook.isActive}
            onCheckedChange={checked => updateWebhook.mutate({ id: webhook.id, isActive: checked })}
            aria-label={t('settings.webhooksActive')}
            className="mr-1"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => testWebhook.mutate(webhook.id)}
            disabled={testWebhook.isPending}
            title={t('settings.webhooksTest')}
            aria-label={t('settings.webhooksTest')}
          >
            {testWebhook.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsExpanded(v => !v)}
            aria-expanded={isExpanded}
            title={t('settings.webhooksDeliveries')}
            aria-label={t('settings.webhooksDeliveries')}
          >
            <ChevronDown className={cn('transition-transform', isExpanded && 'rotate-180')} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            title={t('settings.webhooksDelete')}
            aria-label={t('settings.webhooksDelete')}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {isExpanded && <DeliveryList webhookId={webhook.id} />}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!deleteWebhook.isPending) setConfirmDelete(next)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.webhooksDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.webhooksDeleteConfirm', { name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteWebhook.isPending}>{t('settings.webhooksCancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteWebhook.isPending}
              onClick={() => deleteWebhook.mutate(webhook.id, { onSuccess: () => setConfirmDelete(false) })}
            >
              {deleteWebhook.isPending ? t('settings.webhooksDeleting') : t('settings.webhooksDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function DeliveryList({ webhookId }: { webhookId: string }) {
  const { t } = useTranslation()
  const { data: deliveries, isLoading } = useWebhookDeliveries(webhookId, true)

  if (isLoading) {
    return (
      <div className="border-t px-3 py-4 flex justify-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!deliveries || deliveries.length === 0) {
    return (
      <div className="border-t px-3 py-3 text-center text-xs text-muted-foreground">
        {t('settings.webhooksDeliveriesEmpty')}
      </div>
    )
  }

  return (
    <div className="border-t">
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
        {t('settings.webhooksDeliveries')}
      </div>
      <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-48">
        {deliveries.map(d => (
          <div key={d.id} className="flex items-center gap-2 border-t px-3 py-1.5 text-xs">
            {d.success ?
                (
                  <CircleCheck className="size-3.5 shrink-0 text-green-500" />
                ) :
                (
                  <CircleAlert className="size-3.5 shrink-0 text-destructive" />
                )}
            <span className="text-muted-foreground">{d.event}</span>
            <span className="text-muted-foreground">{d.statusCode ?? '—'}</span>
            {d.duration != null && (
              <span className="text-muted-foreground">
                {d.duration}
                ms
              </span>
            )}
            <span className="ml-auto text-muted-foreground">
              {new Date(d.createdAt).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </ScrollArea>
    </div>
  )
}
