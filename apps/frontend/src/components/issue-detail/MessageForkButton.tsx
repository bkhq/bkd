import { GitBranch } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { ForkDialog } from './ForkDialog'

export function MessageForkButton({
  projectId,
  issueId,
  logId,
  className,
}: {
  projectId: string
  issueId: string
  logId: string
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!projectId || !issueId) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('chat.fork.forkFromMessage')}
        className={cn(
          'rounded p-1 text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-muted/40 transition-all',
          className,
        )}
      >
        <GitBranch className="h-3 w-3" />
      </button>
      <ForkDialog
        open={open}
        onOpenChange={setOpen}
        issueId={issueId}
        projectId={projectId}
        fromLogId={logId}
      />
    </>
  )
}
