import { Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidePanel, SidePanelActions } from '@/components/ui/side-panel'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  MESSAGES_MAX_WIDTH_RATIO,
  MESSAGES_MIN_WIDTH,
  useMessagesStore,
} from '@/stores/messages-store'
import { MessagesInbox } from './MessagesInbox'

export function MessagesDrawer() {
  const { t } = useTranslation()
  const { isOpen, isFullscreen, width, close, minimize, toggleFullscreen, setWidth } =
    useMessagesStore()
  const isMobile = useIsMobile()

  if (!isOpen) return null

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const maxWidth = Math.round(viewportWidth * MESSAGES_MAX_WIDTH_RATIO)

  return (
    <SidePanel
      label={t('messages.title')}
      width={width}
      onWidthChange={setWidth}
      minWidth={MESSAGES_MIN_WIDTH}
      maxWidth={maxWidth}
      resizeLabel={t('messages.resizePanel')}
      fullscreen={isMobile || isFullscreen}
      onClose={close}
      title={(
        <>
          <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {t('messages.title')}
          </span>
        </>
      )}
      actions={(
        <SidePanelActions
          onMinimize={minimize}
          minimizeLabel={t('messages.minimize')}
          isFullscreen={isFullscreen}
          onToggleFullscreen={isMobile ? undefined : toggleFullscreen}
          fullscreenLabel={t('messages.maximize')}
          restoreLabel={t('messages.back')}
          onClose={close}
          closeLabel={t('messages.close')}
        />
      )}
    >
      <MessagesInbox />
    </SidePanel>
  )
}
