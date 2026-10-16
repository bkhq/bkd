import { useTranslation } from 'react-i18next'
import { formatFileSize } from '@/lib/format'
import { cn } from 'cn'
import { useUploadStore } from '@/stores/upload-store'

export function UploadProgress() {
  const { t } = useTranslation()
  const uploads = useUploadStore(s => s.uploads)

  if (uploads.length === 0) return null

  return (
    <div className="fixed right-4 bottom-4 z-50 flex w-72 flex-col gap-2" aria-live="polite">
      {uploads.map((u) => {
        const percent = u.total > 0 ? Math.round((u.loaded / u.total) * 100) : 0
        const statusText = u.status === 'done'
          ? t('upload.done')
          : u.status === 'error'
            ? t('upload.failed')
            : percent === 100 ? t('upload.processing') : `${percent}%`
        return (
          <div key={u.id} className="rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 truncate font-medium">{u.fileName}</span>
              {u.fileCount > 1 && <span className="shrink-0 text-muted-foreground">{`+${u.fileCount - 1}`}</span>}
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{statusText}</span>
            </div>
            <div
              role="progressbar"
              aria-label={u.fileName}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn('h-full rounded-full transition-[width]', u.status === 'error' ? 'bg-destructive' : 'bg-primary')}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              {`${formatFileSize(u.loaded)} / ${formatFileSize(u.total)}`}
            </div>
          </div>
        )
      })}
    </div>
  )
}
