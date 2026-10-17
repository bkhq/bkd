import type { MessageIssueLink } from '@bkd/shared'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function IssueLink({ label, link }: { label: string, link: MessageIssueLink | null }) {
  if (!link) return null
  return (
    <span className="min-w-0 truncate">
      {label}
      {' '}
      <Link
        to={`/projects/${link.projectId}/issues/${link.issueId}`}
        className="text-foreground underline-offset-2 hover:underline"
      >
        {`#${link.issueNumber} ${link.title}`}
      </Link>
    </span>
  )
}

export function Fact({ label, value }: { label: string, value: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd>
    </div>
  )
}

/** The answer is recorded but the source issue was never woken. */
export function NotDelivered({ message, pending, onResend }: {
  message: string
  pending: boolean
  onResend: () => void
}) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button variant="outline" size="sm" disabled={pending} onClick={onResend}>
        {t('decisions.resend')}
      </Button>
    </div>
  )
}
