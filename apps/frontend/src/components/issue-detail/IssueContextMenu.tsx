import { Copy, Download, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDeleteIssue, useDuplicateIssue, useUpdateIssue } from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'
import type { Issue } from '@/types/kanban'

interface IssueContextMenuProps {
  issue: Issue
  projectId: string
  showPin?: boolean
  children: ReactNode
}

export function IssueContextMenu({
  issue,
  projectId,
  showPin = false,
  children,
}: IssueContextMenuProps) {
  const { t } = useTranslation()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(issue.title)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const updateIssue = useUpdateIssue(projectId)
  const deleteIssue = useDeleteIssue(projectId)
  const duplicateIssue = useDuplicateIssue(projectId)

  useEffect(() => {
    if (renameOpen) {
      setRenameValue(issue.title)
      const timer = setTimeout(() => renameInputRef.current?.select(), 0)
      return () => clearTimeout(timer)
    }
  }, [renameOpen, issue.title])

  const handlePin = useCallback(() => {
    updateIssue.mutate({ id: issue.id, isPinned: !issue.isPinned })
  }, [updateIssue, issue.id, issue.isPinned])

  const handleRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== issue.title) {
      updateIssue.mutate({ id: issue.id, title: trimmed })
    }
    setRenameOpen(false)
  }, [updateIssue, issue.id, issue.title, renameValue])

  const handleDuplicate = useCallback(() => {
    duplicateIssue.mutate(issue.id)
  }, [duplicateIssue, issue.id])

  const handleExport = useCallback(
    (format: 'json' | 'txt') => {
      const url = kanbanApi.exportIssueUrl(projectId, issue.id, format)
      const a = document.createElement('a')
      a.href = url
      a.download = ''
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    },
    [projectId, issue.id],
  )

  const handleDelete = useCallback(() => {
    deleteIssue.mutate(issue.id)
    setDeleteOpen(false)
  }, [deleteIssue, issue.id])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={children as React.JSX.Element} />
        <DropdownMenuContent align="start" sideOffset={4}>
          {showPin && (
            <DropdownMenuItem onSelect={handlePin}>
              {issue.isPinned
                ? (
                    <>
                      <PinOff className="size-4" />
                      {t('contextMenu.unpin')}
                    </>
                  )
                : (
                    <>
                      <Pin className="size-4" />
                      {t('contextMenu.pinToTop')}
                    </>
                  )}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil className="size-4" />
            {t('contextMenu.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleDuplicate}>
            <Copy className="size-4" />
            {t('contextMenu.copy')}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Download className="size-4" />
              {t('contextMenu.download')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => handleExport('json')}>
                {t('contextMenu.exportJson')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport('txt')}>
                {t('contextMenu.exportTxt')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
            {t('contextMenu.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('contextMenu.renameTitle')}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleRename()
            }}
          >
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              placeholder={t('contextMenu.newTitle')}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!renameValue.trim()}>
                {t('contextMenu.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('contextMenu.delete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('contextMenu.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('contextMenu.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** Kebab "..." button to use as trigger */
export function IssueContextMenuButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors ${className ?? ''}`}
      onClick={e => e.stopPropagation()}
    >
      <MoreHorizontal className="size-3.5" />
    </button>
  )
}
