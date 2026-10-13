import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { TREE_PANE_MAX_WIDTH, TREE_PANE_MIN_WIDTH, useTreePaneStore } from '@/stores/tree-pane-store'

/** Left-hand file-tree column, resizable from its right edge. */
export function TreePane({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const width = useTreePaneStore(s => s.width)
  const setWidth = useTreePaneStore(s => s.setWidth)
  return (
    <aside className="relative shrink-0 border-r border-border/60" style={{ width }}>
      {children}
      <ResizeHandle
        edge="right"
        width={width}
        onWidthChange={setWidth}
        min={TREE_PANE_MIN_WIDTH}
        max={TREE_PANE_MAX_WIDTH}
        label={t('fileBrowser.resizeTree')}
      />
    </aside>
  )
}
