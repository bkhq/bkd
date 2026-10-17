import type { Message, MessageLevel } from '@bkd/shared'
import type { LucideIcon } from 'lucide-react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownContent } from '@/components/issue-detail/MarkdownContent'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { cn } from 'cn'
import { formatDateTime } from '@/lib/format'
import { Fact, IssueLink, NotDelivered } from './MessageParts'

const LEVEL_ICONS: Record<MessageLevel, { icon: LucideIcon, className: string }> = {
  info: { icon: Info, className: 'text-muted-foreground' },
  success: { icon: CircleCheck, className: 'text-emerald-600 dark:text-emerald-400' },
  warning: { icon: TriangleAlert, className: 'text-amber-600 dark:text-amber-400' },
  error: { icon: CircleAlert, className: 'text-destructive' },
}

export function NotificationCard({
  message,
  onRead,
  onReply,
  onClose,
  onResend,
  pending = false,
}: {
  message: Message
  onRead: () => void
  onReply: (text: string) => void
  onClose: () => void
  onResend: () => void
  pending?: boolean
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  const awaitsReply = message.expects === 'reply' && message.status === 'open'
  const canClose = message.expects === 'reply' && (message.status === 'open' || message.status === 'replied')
  const waiting = awaitsReply || message.status === 'unread'
  const { icon: Icon, className: iconClass } = LEVEL_ICONS[message.level]
  const trimmed = text.trim()

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', iconClass)} aria-label={t(`messages.level.${message.level}`)} />
          <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug break-words">
            {message.title}
          </h2>
          <Badge variant={waiting ? 'default' : 'secondary'} className="shrink-0">
            {t(`messages.status.${message.status}`)}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {message.links.projectName ? <span>{message.links.projectName}</span> : null}
          {message.campaignId ? <span>{message.campaignId}</span> : null}
          <span>{formatDateTime(message.createdAt)}</span>
          <IssueLink label={t('decisions.concerns')} link={message.links.ref} />
          <IssueLink label={t('messages.from')} link={message.links.source} />
        </div>

        {message.body ? <MarkdownContent content={message.body} className="text-sm" /> : null}

        {awaitsReply ?
            (
              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={t('messages.replyPlaceholder')}
                aria-label={t('messages.reply')}
              />
            ) :
          null}

        {message.reply ?
            (
              <dl className="space-y-1 rounded-md border px-3 py-2">
                <Fact label={t('messages.reply')} value={message.reply.text} />
                <Fact
                  label={t('messages.repliedBy')}
                  value={`${message.reply.repliedBy} · ${formatDateTime(message.reply.repliedAt)}`}
                />
              </dl>
            ) :
          null}

        <dl className="space-y-1">
          <Fact label={t('decisions.outcome')} value={message.outcome} />
          <Fact label={t('decisions.withdrawReason')} value={message.withdrawReason} />
          <Fact label={t('decisions.closeReason')} value={message.closeReason} />
        </dl>

        {message.status === 'replied' && !message.notifiedAt ?
            <NotDelivered message={t('messages.notDelivered')} pending={pending} onResend={onResend} /> :
          null}

        {message.status === 'unread' || canClose ?
            (
              <div className="flex justify-end gap-2">
                {message.status === 'unread' ?
                    (
                      <Button variant="outline" size="sm" disabled={pending} onClick={onRead}>
                        {t('messages.markRead')}
                      </Button>
                    ) :
                  null}
                {canClose ?
                    (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>
                        {t('decisions.close')}
                      </Button>
                    ) :
                  null}
                {awaitsReply ?
                    (
                      <Button size="sm" disabled={pending || !trimmed} onClick={() => onReply(trimmed)}>
                        {t('messages.send')}
                      </Button>
                    ) :
                  null}
              </div>
            ) :
          null}
      </CardContent>
    </Card>
  )
}
