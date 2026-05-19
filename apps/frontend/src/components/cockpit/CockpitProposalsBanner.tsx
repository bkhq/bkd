import { Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  useApproveCockpitProposal,
  useCockpitProposals,
  useRejectCockpitProposal,
} from '@/hooks/use-cockpit-proposals'

const TYPE_LABEL: Record<string, string> = {
  cancel_issue: 'cancel',
  restart_issue: 'restart',
  bulk_update_status: 'bulk',
  create_issue: 'create',
}

export function CockpitProposalsBanner() {
  const { t } = useTranslation()
  const { data } = useCockpitProposals()
  const approve = useApproveCockpitProposal()
  const reject = useRejectCockpitProposal()

  if (!data || data.length === 0) return null

  return (
    <div
      data-testid="cockpit-proposals-banner"
      className="flex flex-col gap-2 border-b border-border/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2"
    >
      <div className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-300">
        {t('cockpit.proposals.title', 'Pending AI actions')}
      </div>
      {data.map(p => (
        <div
          key={p.id}
          data-testid={`cockpit-proposal-row-${p.id}`}
          className="flex items-start justify-between gap-2 rounded-md border border-amber-200 dark:border-amber-800/50 bg-card p-2"
        >
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="text-[10px] font-mono uppercase text-muted-foreground/70">
              {TYPE_LABEL[p.type] ?? p.type}
            </span>
            <span className="text-sm text-foreground/90 break-words">{p.summary}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-testid={`cockpit-proposal-reject-${p.id}`}
              onClick={() => reject.mutate(p.id)}
              disabled={reject.isPending}
              aria-label={t('cockpit.proposals.reject', 'Reject')}
              className="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 active:bg-destructive/20 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              data-testid={`cockpit-proposal-approve-${p.id}`}
              onClick={() => approve.mutate(p.id)}
              disabled={approve.isPending}
              aria-label={t('cockpit.proposals.approve', 'Approve')}
              className="flex h-11 w-11 md:h-9 md:w-9 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
