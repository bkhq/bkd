import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  FILE_BROWSER_MAX_WIDTH_RATIO,
  FILE_BROWSER_MIN_WIDTH,
  useFileBrowserStore,
} from '@/stores/file-browser-store'
import { FileBrowserContent } from './FileBrowserContent'

export function FileBrowserDrawer() {
  const { t } = useTranslation()
  const {
    isOpen,
    isFullscreen,
    isDrawer,
    width,
    projectId,
    close,
    minimize,
    toggleFullscreen,
    setWidth,
  } = useFileBrowserStore()
  const isMobile = useIsMobile()

  if (!isOpen || !projectId || !isDrawer) return null

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const maxWidth = Math.round(viewportWidth * FILE_BROWSER_MAX_WIDTH_RATIO)
  const fullscreen = isMobile || isFullscreen
  const effectiveWidth = fullscreen ? viewportWidth : width

  return (
    <>
      {/* Backdrop overlay */}
      {fullscreen
        ? null
        : (
            <div className="fixed inset-0 z-[39] bg-black/20" onClick={close} onKeyDown={undefined} />
          )}
      <div
        className={`fixed top-0 bottom-0 right-0 z-40 flex flex-col border-l border-border bg-background shadow-2xl ${
          fullscreen ? 'left-0' : ''
        }`}
        style={fullscreen ? undefined : { width: effectiveWidth }}
      >
        {/* Resize handle — hidden in fullscreen and on mobile */}
        {!fullscreen && (
          <ResizeHandle
            width={width}
            onWidthChange={setWidth}
            min={FILE_BROWSER_MIN_WIDTH}
            max={maxWidth}
            label={t('fileBrowser.resizePanel')}
          />
        )}

        <FileBrowserContent
          enabled={isOpen}
          headerActions={(
            <>
              <button
                type="button"
                onClick={minimize}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label={t('terminal.minimize')}
                title={t('terminal.minimize')}
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              {!isMobile && (
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label={t('terminal.maximize')}
                  title={isFullscreen ? t('terminal.back') : t('terminal.maximize')}
                >
                  {isFullscreen
                    ? <Minimize2 className="h-3.5 w-3.5" />
                    : <Maximize2 className="h-3.5 w-3.5" />}
                </button>
              )}
              <button
                type="button"
                onClick={close}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
                aria-label={t('fileBrowser.close')}
                title={t('fileBrowser.close')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        />
      </div>
    </>
  )
}
