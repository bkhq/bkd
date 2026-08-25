import { useTranslation } from 'react-i18next'
import { SidePanel, SidePanelActions } from '@/components/ui/side-panel'
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

  return (
    <SidePanel
      label={t('fileBrowser.title')}
      width={width}
      onWidthChange={setWidth}
      minWidth={FILE_BROWSER_MIN_WIDTH}
      maxWidth={maxWidth}
      resizeLabel={t('fileBrowser.resizePanel')}
      fullscreen={isMobile || isFullscreen}
      onClose={close}
    >
      {/* The content renders its own header, so the shell supplies only the
          standard action buttons. */}
      <FileBrowserContent
        enabled={isOpen}
        headerActions={(
          <SidePanelActions
            onMinimize={minimize}
            minimizeLabel={t('terminal.minimize')}
            isFullscreen={isFullscreen}
            onToggleFullscreen={isMobile ? undefined : toggleFullscreen}
            fullscreenLabel={t('terminal.maximize')}
            restoreLabel={t('terminal.back')}
            onClose={close}
            closeLabel={t('fileBrowser.close')}
          />
        )}
      />
    </SidePanel>
  )
}
