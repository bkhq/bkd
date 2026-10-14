import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { TREE_PANE_MAX_WIDTH, TREE_PANE_MIN_WIDTH, useTreePaneStore } from '@/stores/tree-pane-store'

/**
 * Left-hand file-tree column, resizable from its right edge. With `fill` it
 * takes the whole width instead (phones, where tree and content take turns).
 */
export function TreePane({ children, fill }: { children: ReactNode, fill?: boolean }) {
  const { t } = useTranslation()
  const width = useTreePaneStore(s => s.width)
  const setWidth = useTreePaneStore(s => s.setWidth)
  if (fill) return <aside className="flex min-w-0 flex-1 flex-col">{children}</aside>
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
