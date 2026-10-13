import { ContextMenu } from '@base-ui/react/context-menu'
import { ChevronRight, Copy, File, Folder, FolderOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from 'cn'
import { DropdownMenuItem, dropdownMenuPopupClassName } from '@/components/ui/dropdown-menu'

/** One row of a file tree: indentation, chevron + folder icon or file icon, name, trailing slot. */
export function TreeRow({
  depth,
  name,
  isDir,
  expanded,
  selected,
  title,
  trailing,
  onClick,
  copyPaths,
}: {
  depth: number
  name: string
  isDir: boolean
  expanded?: boolean
  selected?: boolean
  title?: string
  trailing?: ReactNode
  onClick: () => void
  /** Enables the right-click menu with copy-path actions. */
  copyPaths?: { absolute: string, relative: string }
}) {
  const DirIcon = expanded ? FolderOpen : Folder
  const row = (
    <button
      type="button"
      onClick={onClick}
      title={title ?? name}
      aria-expanded={isDir ? expanded : undefined}
      className={cn(
        'flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-xs transition-colors',
        selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
      // 12px per level, plus room for the chevron on files
      style={{ paddingLeft: depth * 12 + (isDir ? 4 : 20) }}
    >
      {isDir && (
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')} />
      )}
      {isDir
        ? <DirIcon className="h-3.5 w-3.5 shrink-0" />
        : <File className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {trailing}
    </button>
  )
  if (!copyPaths) return row
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className="contents">{row}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="isolate z-50 outline-none">
          <ContextMenu.Popup className={cn(dropdownMenuPopupClassName, 'w-auto')}>
            <CopyItem label="fileBrowser.copyPath" text={copyPaths.absolute} />
            <CopyItem label="fileBrowser.copyRelativePath" text={copyPaths.relative} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function CopyItem({ label, text }: { label: string, text: string }) {
  const { t } = useTranslation()
  return (
    <DropdownMenuItem
      className="whitespace-nowrap text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => toast.success(t('fileBrowser.pathCopied')))
      }}
    >
      <Copy className="h-3.5 w-3.5" />
      {t(label)}
    </DropdownMenuItem>
  )
}
