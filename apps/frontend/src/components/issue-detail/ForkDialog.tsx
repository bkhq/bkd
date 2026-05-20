import type { ForkMode, Issue } from '@/types/kanban'
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

const MODES: ForkMode[] = ['independent', 'snapshot', 'dependent']

export function ForkDialog({
  open,
  onOpenChange,
  issue,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  issue: Issue
  projectId: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const forkIssue = useForkIssue(projectId)

  const [instruction, setInstruction] = useState('')
  const [mode, setMode] = useState<ForkMode>('independent')
  const [includeHistory, setIncludeHistory] = useState(false)
  const [inheritEngine, setInheritEngine] = useState(true)

  const reset = () => {
    setInstruction('')
    setMode('independent')
    setIncludeHistory(false)
    setInheritEngine(true)
  }

  const submit = (autoExecute: boolean) => {
    const trimmed = instruction.trim()
    if (!trimmed) return
    forkIssue.mutate(
      { issueId: issue.id, data: { instruction: trimmed, mode, includeHistory, inheritEngine, autoExecute } },
      {
        onSuccess: (res) => {
          onOpenChange(false)
          reset()
          if (res.carryWarning) toast.warning(res.carryWarning)
          if (res.mode === 'dependent') {
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

  const isDependent = mode === 'dependent'
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
          <DialogDescription>{t('chat.fork.dialog.subtitle')}</DialogDescription>
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
            {MODES.map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                  mode === m
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                    mode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground',
                  )}
                >
                  {mode === m && <Check className="size-3" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {t(`chat.fork.dialog.mode.${m}`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`chat.fork.dialog.mode.${m}Desc`)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm">{t('chat.fork.dialog.includeHistory')}</span>
            <Switch checked={includeHistory} onCheckedChange={setIncludeHistory} />
          </label>
          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm">{t('chat.fork.dialog.inheritEngine')}</span>
            <Switch checked={inheritEngine} onCheckedChange={setInheritEngine} />
          </label>
        </div>

        <DialogFooter>
          {isDependent
            ? (
                <Button disabled={!canSubmit} onClick={() => submit(false)}>
                  {t('chat.fork.dialog.schedule')}
                </Button>
              )
            : (
                <>
                  <Button variant="outline" disabled={!canSubmit} onClick={() => submit(false)}>
                    {t('chat.fork.dialog.createOnly')}
                  </Button>
                  <Button disabled={!canSubmit} onClick={() => submit(true)}>
                    {t('chat.fork.dialog.createAndRun')}
                  </Button>
                </>
              )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
