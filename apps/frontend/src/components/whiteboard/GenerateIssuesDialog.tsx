import { Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateIssue } from '@/hooks/use-kanban'

interface GeneratedIssueItem {
  nodeId: string
  title: string
  prompt: string
}

interface GenerateIssuesDialogProps {
  projectId: string
  items: GeneratedIssueItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (count: number) => void
}

export function GenerateIssuesDialog({
  projectId,
  items,
  open,
  onOpenChange,
  onCreated,
}: GenerateIssuesDialogProps) {
  const { t } = useTranslation()
  const createIssue = useCreateIssue(projectId)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map(i => i.nodeId)))
  const [creating, setCreating] = useState(false)

  // Reset selection when items change
  const itemKey = items.map(i => i.nodeId).join(',')
  const [lastKey, setLastKey] = useState(itemKey)
  if (itemKey !== lastKey) {
    setLastKey(itemKey)
    setSelected(new Set(items.map(i => i.nodeId)))
  }

  const toggleItem = useCallback((nodeId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }, [])

  const handleCreate = useCallback(async () => {
    const toCreate = items.filter(i => selected.has(i.nodeId))
    if (toCreate.length === 0) return
    setCreating(true)
    try {
      await Promise.all(
        toCreate.map(item =>
          createIssue.mutateAsync({
            title: item.prompt,
            statusId: 'todo',
          }),
        ),
      )
      onCreated?.(toCreate.length)
      onOpenChange(false)
    } finally {
      setCreating(false)
    }
  }, [items, selected, createIssue, onCreated, onOpenChange])

  const selectedCount = selected.size

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('whiteboard.generateIssuesTitle')}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t('whiteboard.generateIssuesDesc')}
        </p>

        <div className="mt-2 flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
          {items.map(item => (
            <label
              key={item.nodeId}
              className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors"
            >
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={selected.has(item.nodeId)}
                onChange={() => toggleItem(item.nodeId)}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.prompt}</p>
              </div>
            </label>
          ))}
          {items.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('whiteboard.generateIssuesEmpty')}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={creating || selectedCount === 0}>
            {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t('whiteboard.createNIssues', { count: selectedCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
