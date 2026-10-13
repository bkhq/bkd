import { FileWarning } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileContent } from '@/types/kanban'
import { MarkdownRenderer } from './MarkdownRenderer'

const CodeEditor = lazy(() => import('./CodeEditor').then(m => ({ default: m.CodeEditor })))

const spinner = (
  <div className="flex items-center justify-center py-16">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
)

/**
 * Body of an opened file: always editable (truncated files are read-only),
 * with an optional rendered Markdown preview. The caller owns the draft and
 * the header (dirty state, save, menu).
 */
export function FileEditor({
  file,
  root,
  value,
  onChange,
  onSave,
  wrap,
  preview,
}: {
  file: FileContent
  root?: string | null
  value: string
  onChange: (value: string) => void
  onSave: () => void
  wrap: boolean
  /** Show rendered Markdown instead of the editor. */
  preview: boolean
}) {
  const { t } = useTranslation()

  if (file.isBinary) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <FileWarning className="h-10 w-10" />
        <p className="text-sm">{t('fileBrowser.binaryFile')}</p>
      </div>
    )
  }

  if (preview) {
    return (
      <div className="flex-1 min-h-0 overflow-auto">
        <MarkdownRenderer content={value} root={root} path={file.path} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {file.isTruncated && (
        <div className="shrink-0 border-b border-border/60 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          {t('fileBrowser.truncatedReadOnly')}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Suspense fallback={spinner}>
          <CodeEditor
            value={value}
            filePath={file.path}
            onChange={onChange}
            onSave={onSave}
            wrap={wrap}
            readOnly={file.isTruncated}
          />
        </Suspense>
      </div>
    </div>
  )
}
