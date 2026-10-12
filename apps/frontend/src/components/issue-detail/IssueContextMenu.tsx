import { ContextMenu } from '@base-ui/react/context-menu'
import { Copy, Download, Link, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
  dropdownMenuPopupClassName,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDeleteIssue, useDuplicateIssue, useUpdateIssue } from '@/hooks/use-kanban'
import { kanbanApi } from '@/lib/kanban-api'
import { cn } from '@/lib/utils'
import { getIssueUrl } from '@/stores/server-store'
import type { Issue } from '@/types/kanban'

/** Shared rename dialog — used by both IssueContextMenu and IssueRow */
export function RenameDialog({
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
  const [renameValue, setRenameValue] = useState(issue.title)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const updateIssue = useUpdateIssue(projectId)

  useEffect(() => {
    if (open) {
      setRenameValue(issue.title)
      const timer = setTimeout(() => renameInputRef.current?.select(), 0)
      return () => clearTimeout(timer)
    }
  }, [open, issue.title])

  const handleRename = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== issue.title) {
      updateIssue.mutate({ id: issue.id, title: trimmed })
    }
    onOpenChange(false)
  }, [updateIssue, issue.id, issue.title, renameValue, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!renameValue.trim()}>
              {t('contextMenu.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface IssueMenuOptions {
  issue: Issue
  projectId: string
  showPin?: boolean
  /** Add a "Copy link" item (chat header). */
  showCopyLink?: boolean
  /** Called after the issue is successfully deleted (e.g. to navigate away when it was active) */
  onDeleted?: () => void
}

/**
 * Items and dialogs of the issue action menu, shared by the "..." dropdown
 * and the right-click menu. Items are base-ui Menu items, so they work inside
 * either popup.
 */
function useIssueMenu({ issue, projectId, showPin = false, showCopyLink = false, onDeleted }: IssueMenuOptions) {
  const { t } = useTranslation()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const updateIssue = useUpdateIssue(projectId)
  const deleteIssue = useDeleteIssue(projectId)
  const duplicateIssue = useDuplicateIssue(projectId)

  const handlePin = useCallback(() => {
    updateIssue.mutate({ id: issue.id, isPinned: !issue.isPinned })
  }, [updateIssue, issue.id, issue.isPinned])

  const handleDuplicate = useCallback(() => {
    duplicateIssue.mutate(issue.id)
  }, [duplicateIssue, issue.id])

  const handleExport = useCallback(() => {
    const url = kanbanApi.exportIssueUrl(projectId, issue.id)
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [projectId, issue.id])

  const handleCopyLink = useCallback(() => {
    navigator.clipboard
      .writeText(getIssueUrl(projectId, issue.id))
      .then(() => toast.success(t('issue.linkCopied')))
      .catch(() => {})
  }, [projectId, issue.id, t])

  const handleDelete = useCallback(() => {
    deleteIssue.mutate(issue.id, {
      onSuccess: () => onDeleted?.(),
    })
    setDeleteOpen(false)
  }, [deleteIssue, issue.id, onDeleted])

  const items = (
    <>
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
      <DropdownMenuItem onSelect={handleExport}>
        <Download className="size-4" />
        {t('contextMenu.download')}
      </DropdownMenuItem>
      {showCopyLink && (
        <DropdownMenuItem onSelect={handleCopyLink}>
          <Link className="size-4" />
          {t('issue.copyLink')}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
        <Trash2 className="size-4" />
        {t('contextMenu.delete')}
      </DropdownMenuItem>
    </>
  )

  const dialogs = (
    <>
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        issue={issue}
        projectId={projectId}
      />
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

  return { items, dialogs }
}

interface IssueContextMenuProps extends IssueMenuOptions {
  children: ReactNode
}

/** "..." dropdown: `children` is the trigger element. */
export function IssueContextMenu({ children, ...options }: IssueContextMenuProps) {
  const { items, dialogs } = useIssueMenu(options)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={children as React.JSX.Element} />
        <DropdownMenuContent align="start" sideOffset={4}>
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  )
}

interface IssueRightClickMenuProps extends IssueMenuOptions {
  children: ReactNode
  /** Class of the wrapper that receives the right-click; `contents` keeps layout intact. */
  className?: string
}

/** Right-click (context) menu over `children`, with the same items as the dropdown. */
export function IssueRightClickMenu({ children, className, ...options }: IssueRightClickMenuProps) {
  const { items, dialogs } = useIssueMenu(options)
  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger className={className}>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner className="isolate z-50 outline-none">
            <ContextMenu.Popup className={dropdownMenuPopupClassName}>
              {items}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {dialogs}
    </>
  )
}

/** Kebab "..." button to use as trigger */
export function IssueContextMenuButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={cn('inline-flex items-center justify-center rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors', className)}
      onClick={e => e.stopPropagation()}
    >
      <MoreHorizontal className="size-3.5" />
    </button>
  )
}
