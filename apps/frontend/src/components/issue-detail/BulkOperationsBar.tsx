import { RotateCcw, Trash, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBulkOperations } from '@/hooks/use-bulk-operations'
import type { BulkItem } from '@/hooks/use-bulk-operations'
import { useBulkSelectionStore } from '@/stores/bulk-selection-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const STATUS_OPTIONS = ['todo', 'working', 'review', 'done'] as const

export function BulkOperationsBar({
  items,
}: {
  items: BulkItem[]
}) {
  const { t } = useTranslation()
  const clear = useBulkSelectionStore(s => s.clear)
  const { run, progress, isRunning } = useBulkOperations()
  const [lastAction, setLastAction] = useState<string | null>(null)

  if (items.length === 0) return null

  const handle = async (action: 'restart' | 'cancel') => {
    setLastAction(action)
    await run(action, items)
    clear()
    setLastAction(null)
  }

  const handleMove = async (statusId: string) => {
    setLastAction(`move-${statusId}`)
    await run('moveStatus', items, { statusId })
    clear()
    setLastAction(null)
  }

  return (
    <div
      data-testid="bulk-operations-bar"
      className="sticky bottom-0 z-20 flex flex-col gap-2 border-t border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-foreground/80">
          <span className="font-semibold tabular-nums">{items.length}</span>
          <span className="text-muted-foreground/70">{t('bulk.selected', 'selected')}</span>
          {progress && isRunning ?
              (
                <span className="text-[10px] font-mono text-muted-foreground/60">
                  {progress.done}
                  /
                  {progress.total}
                </span>
              ) :
            null}
        </div>
        <button
          type="button"
          onClick={clear}
          aria-label={t('bulk.clear', 'Clear selection')}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          data-testid="bulk-restart"
          disabled={isRunning}
          onClick={() => handle('restart')}
          className="min-h-[40px] md:min-h-0"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {isRunning && lastAction === 'restart' ? t('bulk.running', 'Running…') : t('bulk.restart', 'Restart')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-testid="bulk-cancel"
          disabled={isRunning}
          onClick={() => handle('cancel')}
          className="min-h-[40px] md:min-h-0"
        >
          <Trash className="h-3.5 w-3.5" />
          {t('bulk.cancel', 'Cancel')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <Button
                variant="secondary"
                size="sm"
                disabled={isRunning}
                data-testid="bulk-move"
                className="min-h-[40px] md:min-h-0"
              />
            )}
          >
            {t('bulk.moveTo', 'Move to')}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {STATUS_OPTIONS.map(s => (
              <DropdownMenuItem
                key={s}
                onSelect={() => handleMove(s)}
                data-testid={`bulk-move-to-${s}`}
              >
                {t(`statusName.${s.charAt(0).toUpperCase()}${s.slice(1)}`, s)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
