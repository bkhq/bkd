import { File, Folder, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatFileSize } from '@/lib/format'
import type { FileEntry } from '@/types/kanban'

/** Concrete local date and time, e.g. "2026/11/01 23:01". */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

interface FileListProps {
  entries: FileEntry[]
  onNavigate: (name: string, type: 'file' | 'directory') => void
  /** Asks to delete an entry; the caller confirms. */
  onDelete?: (name: string, type: 'file' | 'directory') => void
}

export function FileList({ entries, onNavigate, onDelete }: FileListProps) {
  const { t } = useTranslation()

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center py-16 text-sm text-muted-foreground">
        {t('fileBrowser.emptyDirectory')}
      </div>
    )
  }

  return (
    <div className="overflow-auto flex-1 min-h-0">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-[1]">
          <tr className="bg-muted border-b border-border">
            <th className="text-left font-medium text-muted-foreground px-4 py-2">
              {t('fileBrowser.name')}
            </th>
            <th className="text-right font-medium text-muted-foreground px-4 py-2 w-24">
              {t('fileBrowser.size')}
            </th>
            <th className="text-right font-medium text-muted-foreground px-4 py-2 w-40 hidden sm:table-cell">
              {t('fileBrowser.modified')}
            </th>
            {onDelete && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => (
            <tr
              key={entry.name}
              className="group/row border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => onNavigate(entry.name, entry.type)}
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  {entry.type === 'directory'
                    ? <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                    : <File className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span
                    className={`truncate ${
                      entry.type === 'directory' ? 'text-foreground font-medium' : 'text-foreground'
                    }`}
                  >
                    {entry.name}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground">
                {entry.type === 'file' ? formatFileSize(entry.size) : '—'}
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell">
                {formatDate(entry.modifiedAt)}
              </td>
              {onDelete && (
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="p-1 rounded opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    title={t('fileBrowser.delete')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(entry.name, entry.type)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
