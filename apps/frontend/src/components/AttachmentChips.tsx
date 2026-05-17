import { FileText, Image as ImageIcon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatFileSize } from '@/lib/format'

/**
 * Shared chip-list renderer for attached files. Clicking a chip triggers
 * `onPreview(file)`; the × button removes by index.
 */
export function AttachmentChips({
  files,
  onPreview,
  onRemove,
}: {
  files: File[]
  onPreview: (file: File) => void
  onRemove: (index: number) => void
}) {
  const { t } = useTranslation()
  if (files.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
      {files.map((file, idx) => (
        <div
          key={`${file.name}-${file.size}-${idx}`}
          className="group/file flex items-center gap-1.5 rounded-lg bg-muted/50 border border-border/40 px-2 py-1 text-xs cursor-pointer hover:bg-muted/70 transition-colors"
          onClick={() => onPreview(file)}
        >
          {file.type.startsWith('image/') ?
              (
                <ImageIcon className="h-3 w-3 shrink-0 text-blue-500" />
              ) :
              (
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
          <span className="truncate max-w-[140px]">{file.name}</span>
          <span className="text-muted-foreground/60">{formatFileSize(file.size)}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove(idx)
            }}
            className="ml-0.5 rounded p-0.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
            title={t('chat.removeFile')}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
