import { Activity } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidePanel, SidePanelActions } from '@/components/ui/side-panel'
import { useAllProcesses } from '@/hooks/use-kanban'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  PROCESS_MANAGER_MAX_WIDTH_RATIO,
  PROCESS_MANAGER_MIN_WIDTH,
  useProcessManagerStore,
} from '@/stores/process-manager-store'
import { ProcessList } from './ProcessList'

export function ProcessManagerDrawer() {
  const { t } = useTranslation()
  const { isOpen, isFullscreen, width, close, minimize, toggleFullscreen, setWidth } =
    useProcessManagerStore()
  const isMobile = useIsMobile()

  const { data, isLoading } = useAllProcesses(isOpen)

  if (!isOpen) return null

  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
  const maxWidth = Math.round(viewportWidth * PROCESS_MANAGER_MAX_WIDTH_RATIO)
  const processes = data?.processes ?? []

  return (
    <SidePanel
      label={t('processManager.title')}
      width={width}
      onWidthChange={setWidth}
      minWidth={PROCESS_MANAGER_MIN_WIDTH}
      maxWidth={maxWidth}
      resizeLabel={t('processManager.resizePanel')}
      fullscreen={isMobile || isFullscreen}
      onClose={close}
      title={(
        <>
          <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium text-muted-foreground">
            {t('processManager.title')}
          </span>
          {processes.length > 0 && <CountBadge count={processes.length} />}
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
          onClose={close}
          closeLabel={t('processManager.close')}
        />
      )}
    >
      <div className="flex-1 overflow-auto min-h-0 p-3">
        {isLoading ?
            (
              <div className="flex items-center justify-center py-16">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) :
          processes.length === 0 ?
              (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                  <Activity className="h-12 w-12" />
                  <p className="text-sm font-medium">{t('processManager.noProcesses')}</p>
                  <p className="text-xs text-center max-w-[240px]">
                    {t('processManager.noProcessesHint')}
                  </p>
                </div>
              ) :
              (
                <ProcessList processes={processes} />
              )}
      </div>
    </SidePanel>
  )
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">
      {count}
    </span>
  )
}
