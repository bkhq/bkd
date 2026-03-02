import {
  Activity,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleX,
  Clock,
  Loader2,
  RotateCcw,
  Square,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCancelIssue, useRestartIssue } from '@/hooks/use-kanban'
import type { ProcessInfo, SessionStatus } from '@/types/kanban'

function StatusIcon({ status }: { status: SessionStatus | null }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
    case 'pending':
      return <Clock className="h-3.5 w-3.5 text-yellow-500" />
    case 'completed':
      return <CircleCheck className="h-3.5 w-3.5 text-green-500" />
    case 'failed':
      return <CircleAlert className="h-3.5 w-3.5 text-destructive" />
    case 'cancelled':
      return <CircleX className="h-3.5 w-3.5 text-muted-foreground" />
    default:
      return <CirclePause className="h-3.5 w-3.5 text-muted-foreground" />
  }
}

function statusVariant(
  status: SessionStatus | null,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'running':
      return 'default'
    case 'pending':
      return 'secondary'
    case 'failed':
      return 'destructive'
    default:
      return 'outline'
  }
}

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return ''
  const diff = Date.now() - new Date(startedAt).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function ProcessList({
  processes,
  projectId,
}: {
  processes: ProcessInfo[]
  projectId: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cancelMutation = useCancelIssue(projectId)
  const restartMutation = useRestartIssue(projectId)

  return (
    <div className="flex flex-col gap-2">
      {processes.map((proc) => (
        <div
          key={proc.issueId}
          className="rounded-lg border border-border bg-card p-3 space-y-2"
        >
          {/* Title row */}
          <div className="flex items-center gap-2 min-w-0">
            <StatusIcon status={proc.sessionStatus} />
            <button
              type="button"
              className="text-xs font-medium text-foreground truncate hover:underline cursor-pointer text-left min-w-0"
              onClick={() =>
                navigate(`/projects/${projectId}/issues/${proc.issueId}`)
              }
            >
              <span className="text-muted-foreground">#{proc.issueNumber}</span>{' '}
              {proc.issueTitle}
            </button>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {proc.sessionStatus && (
              <Badge
                variant={statusVariant(proc.sessionStatus)}
                className="text-[10px] px-1.5 py-0"
              >
                {t(`session.status.${proc.sessionStatus}`)}
              </Badge>
            )}
            {proc.engineType && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {proc.engineType}
              </Badge>
            )}
            {proc.model && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {proc.model}
              </Badge>
            )}
            {proc.turnInFlight && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                <Activity className="h-2.5 w-2.5 mr-0.5" />
                {t('processManager.turnInFlight')}
              </Badge>
            )}
            {proc.startedAt && (
              <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
                {formatDuration(proc.startedAt)}
              </span>
            )}
          </div>

          {/* Actions — cancel for running/pending, restart for failed/cancelled */}
          {(proc.sessionStatus === 'running' ||
            proc.sessionStatus === 'pending' ||
            proc.sessionStatus === 'failed' ||
            proc.sessionStatus === 'cancelled') && (
            <div className="flex items-center gap-1.5 pt-1">
              {(proc.sessionStatus === 'running' ||
                proc.sessionStatus === 'pending') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] gap-1"
                  disabled={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate(proc.issueId)}
                >
                  <Square className="h-3 w-3" />
                  {cancelMutation.isPending
                    ? t('processManager.cancelling')
                    : t('processManager.cancel')}
                </Button>
              )}
              {(proc.sessionStatus === 'failed' ||
                proc.sessionStatus === 'cancelled') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] gap-1"
                  disabled={restartMutation.isPending}
                  onClick={() => restartMutation.mutate(proc.issueId)}
                >
                  <RotateCcw className="h-3 w-3" />
                  {restartMutation.isPending
                    ? t('processManager.restarting')
                    : t('processManager.restart')}
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
