import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const LIST_PANEL_GHOST_WIDTH = 14

export function ListPanelGhost({ onExpand }: { onExpand: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="list-panel-ghost"
      style={{ width: `${LIST_PANEL_GHOST_WIDTH}px` }}
      className="relative h-full shrink-0 border-r border-border bg-secondary/40 hover:bg-secondary transition-colors"
    >
      <button
        type="button"
        data-testid="list-panel-ghost-expand"
        onClick={onExpand}
        aria-label={t('listPanel.expand', 'Expand list')}
        title={t('listPanel.expand', 'Expand list')}
        className="absolute inset-0 flex items-center justify-center text-muted-foreground/40 hover:text-foreground cursor-pointer"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  )
}
