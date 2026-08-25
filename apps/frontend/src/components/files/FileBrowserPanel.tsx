import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { FILE_BROWSER_MAX_WIDTH_RATIO, FILE_BROWSER_MIN_WIDTH } from '@/stores/file-browser-store'
import { SidePanelButton } from '@/components/ui/side-panel'
import { FileBrowserContent } from './FileBrowserContent'

export function FileBrowserPanel({
  width,
  onWidthChange,
  onClose,
  fullScreen,
}: {
  width: number
  onWidthChange: (w: number) => void
  onClose: () => void
  fullScreen?: boolean
}) {
  const { t } = useTranslation()
  const maxWidth = Math.round((typeof window === 'undefined' ? 800 : window.innerWidth) * FILE_BROWSER_MAX_WIDTH_RATIO)

  return (
    <div
      className={
        fullScreen
          ? 'flex flex-col flex-1 min-h-0 bg-background'
          : 'relative h-full shrink-0 border-l border-border bg-background'
      }
      style={fullScreen ? undefined : { width }}
    >
      {/* Resize handle */}
      {!fullScreen && (
        <ResizeHandle
          width={width}
          onWidthChange={onWidthChange}
          min={FILE_BROWSER_MIN_WIDTH}
          max={maxWidth}
          label={t('fileBrowser.resizePanel')}
        />
      )}

      <div className="flex flex-col h-full min-h-0">
        <FileBrowserContent
          headerActions={(
            <SidePanelButton
              icon={X}
              label={t('fileBrowser.close')}
              onClick={onClose}
              destructive
            />
          )}
        />
      </div>
    </div>
  )
}
