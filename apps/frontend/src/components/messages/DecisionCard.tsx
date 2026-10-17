import type { Message } from '@bkd/shared'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/format'
import { Fact, IssueLink, NotDelivered } from './MessageParts'

export function DecisionCard({
  event,
  onDecide,
  onClose,
  onResend,
  pending = false,
}: {
  event: Message
  onDecide: (data: { optionId: string | null, instruction: string }) => void
  onClose: () => void
  onResend: () => void
  pending?: boolean
}) {
  const { t } = useTranslation()
  const groupId = useId()
  const [optionId, setOptionId] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')

  const isOpen = event.status === 'open'
  const canClose = isOpen || event.status === 'decided'
  const { decision } = event
  const chosen = decision?.optionId
    ? event.options.find(o => o.id === decision.optionId)
    : undefined
  const trimmed = instruction.trim()

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug break-words">
            {event.title}
          </h2>
          <Badge variant={isOpen ? 'default' : 'secondary'} className="shrink-0">
            {t(`decisions.status.${event.status}`)}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {event.links.projectName ? <span>{event.links.projectName}</span> : null}
          {event.campaignId ? <span>{event.campaignId}</span> : null}
          <span>{formatDateTime(event.createdAt)}</span>
          <IssueLink label={t('decisions.concerns')} link={event.links.ref} />
          <IssueLink label={t('decisions.raisedBy')} link={event.links.source} />
        </div>

        {event.body ?
            (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap break-words">
                {event.body}
              </p>
            ) :
          null}

        <dl className="space-y-1">
          <Fact label={t('decisions.blocks')} value={event.blocks} />
          <Fact label={t('decisions.continues')} value={event.continues} />
        </dl>

        {isOpen ?
            (
              <>
                {event.options.length > 0 ?
                    (
                      <div role="radiogroup" aria-label={t('decisions.options')} className="space-y-2">
                        {event.options.map((option) => {
                          const recommended = event.recommendation?.optionId === option.id
                          return (
                            <label
                              key={option.id}
                              className="flex cursor-pointer gap-2.5 rounded-md border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5"
                            >
                              <input
                                type="radio"
                                name={groupId}
                                className="mt-1 accent-primary"
                                checked={optionId === option.id}
                                onChange={() => setOptionId(option.id)}
                              />
                              <span className="min-w-0 flex-1 space-y-0.5">
                                <span className="flex flex-wrap items-center gap-2 font-medium">
                                  {`${option.id}. ${option.label}`}
                                  {recommended ?
                                      <Badge variant="outline">{t('decisions.recommended')}</Badge> :
                                    null}
                                </span>
                                {option.impact ?
                                    <span className="block text-muted-foreground">{option.impact}</span> :
                                  null}
                                {recommended && event.recommendation?.reason ?
                                    (
                                      <span className="block text-muted-foreground">
                                        {`${t('decisions.recommended')}: ${event.recommendation.reason}`}
                                      </span>
                                    ) :
                                  null}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    ) :
                  null}
                <Textarea
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  placeholder={t('decisions.instructionPlaceholder')}
                  aria-label={t('decisions.instruction')}
                />
              </>
            ) :
          null}

        {decision ?
            (
              <dl className="space-y-1 rounded-md border px-3 py-2">
                <Fact
                  label={t('decisions.decision')}
                  value={chosen ? `${chosen.id}. ${chosen.label}` : decision.optionId}
                />
                <Fact label={t('decisions.instruction')} value={decision.instruction} />
                <Fact
                  label={t('decisions.decidedBy')}
                  value={`${decision.decidedBy} · ${formatDateTime(decision.decidedAt)}`}
                />
              </dl>
            ) :
          null}

        <dl className="space-y-1">
          <Fact label={t('decisions.outcome')} value={event.outcome} />
          <Fact label={t('decisions.withdrawReason')} value={event.withdrawReason} />
          <Fact label={t('decisions.closeReason')} value={event.closeReason} />
        </dl>

        {event.status === 'decided' && !event.notifiedAt ?
            <NotDelivered message={t('decisions.notDelivered')} pending={pending} onResend={onResend} /> :
          null}

        {canClose ?
            (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>
                  {t('decisions.close')}
                </Button>
                {isOpen ?
                    (
                      <Button
                        size="sm"
                        disabled={pending || (!optionId && !trimmed)}
                        onClick={() => onDecide({ optionId, instruction: trimmed })}
                      >
                        {t('decisions.decide')}
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
