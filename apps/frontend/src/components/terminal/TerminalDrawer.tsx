import { TerminalSquare, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidePanel, SidePanelActions } from '@/components/ui/side-panel'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  TERMINAL_MAX_WIDTH_RATIO,
  TERMINAL_MIN_WIDTH,
  useTerminalStore,
} from '@/stores/terminal-store'
import { disposeTerminal, TerminalView } from './TerminalView'

export function TerminalDrawer() {
  const { t } = useTranslation()
  const { isOpen, isFullscreen, width, close, minimize, toggleFullscreen, setWidth } =
    useTerminalStore()
  const isMobile = useIsMobile()

  if (!isOpen) return null

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const maxWidth = Math.round(viewportWidth * TERMINAL_MAX_WIDTH_RATIO)

  return (
    <SidePanel
      label={t('terminal.title')}
      width={width}
      onWidthChange={setWidth}
      minWidth={TERMINAL_MIN_WIDTH}
      maxWidth={maxWidth}
      resizeLabel={t('terminal.resizePanel')}
      fullscreen={isMobile || isFullscreen}
      onClose={close}
      title={(
        <>
          <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {t('terminal.title')}
          </span>
        </>
      )}
      actions={(
        <SidePanelActions
          onMinimize={minimize}
          minimizeLabel={t('terminal.minimize')}
          isFullscreen={isFullscreen}
          onToggleFullscreen={isMobile ? undefined : toggleFullscreen}
          fullscreenLabel={t('terminal.maximize')}
          restoreLabel={t('terminal.back')}
          onClose={() => {
            disposeTerminal()
            close()
          }}
          closeLabel={t('terminal.kill')}
          closeIcon={Trash2}
          destructiveClose
        />
      )}
    >
      <TerminalView className="min-h-0 flex-1 p-1" />
    </SidePanel>
  )
}
