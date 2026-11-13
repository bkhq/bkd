import { cn } from 'cn'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEngineUpdate, useStartEngineUpdate } from '@/hooks/use-kanban'

/** Runs an engine CLI's own updater and shows its output until it ends. */
export function EngineUpdateButton({ engineType, name }: { engineType: string, name: string }) {
  const { t } = useTranslation()
  const start = useStartEngineUpdate()
  const [updateId, setUpdateId] = useState<string>()
  const [open, setOpen] = useState(false)
  const { data: update } = useEngineUpdate(updateId)
  const running = start.isPending || update?.status === 'running'
  const endRef = useRef<HTMLDivElement>(null)
  const lines = update?.output.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [lines])

  const onUpdate = () => {
    setOpen(true)
    start.mutate(engineType, { onSuccess: u => setUpdateId(u.id) })
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={onUpdate} disabled={running}>
        <RefreshCw className={cn('size-3', running && 'animate-spin')} />
        {t('settings.engineUpdate.button')}
      </Button>
      <Dialog open={open} onOpenChange={next => (next || !running) && setOpen(next)}>
        <DialogContent className="sm:max-w-lg" showCloseButton={!running}>
          <DialogHeader>
            <DialogTitle>{t('settings.engineUpdate.title', { name })}</DialogTitle>
            <DialogDescription>{t('settings.engineUpdate.hint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <p
              className={cn(
                'text-xs font-medium',
                update?.status === 'failed' ? 'text-destructive' : update?.status === 'succeeded' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
              )}
            >
              {start.error
                ? start.error.message
                : update?.status === 'failed'
                  ? `${t('settings.engineUpdate.failed')}: ${update.error ?? ''}`
                  : update?.status === 'succeeded'
                    ? update.toVersion && update.toVersion !== update.fromVersion
                      ? `v${update.fromVersion ?? '?'} → v${update.toVersion}`
                      : t('settings.engineUpdate.upToDate', { version: update.toVersion ?? update.fromVersion ?? '?' })
                    : t('settings.engineUpdate.running')}
            </p>
            {update && update.output.length > 0
              ? (
                  <ScrollArea className="rounded-md bg-muted/50 [&>[data-slot=scroll-area-viewport]]:max-h-48">
                    <pre className="p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                      {update.output.join('\n')}
                      <div ref={endRef} />
                    </pre>
                  </ScrollArea>
                )
              : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={running} onClick={() => setOpen(false)}>
              {t('settings.engineUpdate.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
