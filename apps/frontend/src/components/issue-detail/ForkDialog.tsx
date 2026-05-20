import type { ForkRunWhen } from '@/types/kanban'
import { Check, GitBranch } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useForkIssue } from '@/hooks/use-kanban'
import { cn } from '@/lib/utils'

const RUN_WHEN: ForkRunWhen[] = ['now', 'after-parent']

export function ForkDialog({
  open,
  onOpenChange,
  issueId,
  projectId,
  fromLogId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  issueId: string
  projectId: string
  /** When set, fork from this message — context is the parent chat up to here. */
  fromLogId?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const forkIssue = useForkIssue(projectId)

  const [instruction, setInstruction] = useState('')
  const [runWhen, setRunWhen] = useState<ForkRunWhen>('now')
  const [inheritEngine, setInheritEngine] = useState(true)

  const reset = () => {
    setInstruction('')
    setRunWhen('now')
    setInheritEngine(true)
  }

  const submit = () => {
    const trimmed = instruction.trim()
    if (!trimmed) return
    forkIssue.mutate(
      { issueId, data: { instruction: trimmed, runWhen, fromLogId, inheritEngine } },
      {
        onSuccess: (res) => {
          onOpenChange(false)
          reset()
          if (res.carryWarning) toast.warning(res.carryWarning)
          if (res.runWhen === 'after-parent') {
            toast.success(t('chat.fork.toast.scheduled'))
          } else {
            toast.success(t('chat.fork.toast.started'))
            navigate(`/projects/${projectId}/issues/${res.issue.id}`)
          }
        },
        onError: (err: unknown) => {
          toast.error(err instanceof Error ? err.message : t('chat.fork.toast.failed'))
        },
      },
    )
  }

  const canSubmit = instruction.trim().length > 0 && !forkIssue.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-4" />
            {t('chat.fork.dialog.title')}
          </DialogTitle>
          <DialogDescription>
            {fromLogId ? t('chat.fork.dialog.fromMessage') : t('chat.fork.dialog.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder={t('chat.fork.dialog.instruction')}
            className="min-h-24"
            autoFocus
          />

          <div className="space-y-2">
            {RUN_WHEN.map(w => (
              <button
                key={w}
                type="button"
                onClick={() => setRunWhen(w)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  runWhen === w ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                    runWhen === w
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground',
                  )}
                >
                  {runWhen === w && <Check className="size-3" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`chat.fork.dialog.runWhen.${w}`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`chat.fork.dialog.runWhen.${w}Desc`)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm">{t('chat.fork.dialog.inheritEngine')}</span>
            <Switch checked={inheritEngine} onCheckedChange={setInheritEngine} />
          </label>
        </div>

        <DialogFooter>
          <Button disabled={!canSubmit} onClick={submit}>
            {runWhen === 'after-parent'
              ? t('chat.fork.dialog.schedule')
              : t('chat.fork.dialog.createAndRun')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
