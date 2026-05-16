import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  FILE_BROWSER_MAX_WIDTH_RATIO,
  FILE_BROWSER_MIN_WIDTH,
  useFileBrowserStore,
} from '@/stores/file-browser-store'
import { FileBrowserContent } from './FileBrowserContent'

/**
 * Tag names whose `keydown` events should NOT trigger drawer-level Esc-close.
 *
 * Without this, pressing Esc while typing in a file-search box or the goto
 * line input would dismiss the entire drawer.
 */
const ESC_BLOCK_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

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
  const dragRef = useRef<{ startX: number, startWidth: number } | null>(null)
  /**
   * Records the element that had focus when the drawer opened so we can
   * restore it on close — keeps the chat composer responsive.
   */
  const prevFocusRef = useRef<HTMLElement | null>(null)

  // Esc-to-close + focus preservation. Both are scoped to when the drawer
  // is actually mounted, so we don't burn a listener while the drawer is
  // closed (which is the steady state).
  useEffect(() => {
    if (!isOpen || !isDrawer) return
    prevFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      // Don't hijack Esc when the user is editing text or
      // contenteditable — those inputs may have their own Esc handling.
      if (target && (ESC_BLOCK_TAGS.has(target.tagName) || target.isContentEditable)) return
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      // Restore previous focus on unmount/close, but only if it still lives.
      const prev = prevFocusRef.current
      if (prev && document.contains(prev)) prev.focus()
      prevFocusRef.current = null
    }
  }, [isOpen, isDrawer, close])

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
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('fileBrowser.resizePanel')}
            aria-valuenow={width}
            aria-valuemin={FILE_BROWSER_MIN_WIDTH}
            aria-valuemax={maxWidth}
            tabIndex={0}
            className="absolute top-0 bottom-0 left-0 w-2 -translate-x-1/2 z-10 cursor-col-resize group select-none outline-none"
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              e.currentTarget.setPointerCapture(e.pointerId)
              dragRef.current = { startX: e.clientX, startWidth: width }
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return
              const dx = dragRef.current.startX - e.clientX
              setWidth(dragRef.current.startWidth + dx)
            }}
            onPointerUp={() => {
              dragRef.current = null
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 50 : 10
              if (e.key === 'ArrowLeft') {
                e.preventDefault()
                setWidth(width + step)
              }
              if (e.key === 'ArrowRight') {
                e.preventDefault()
                setWidth(width - step)
              }
            }}
          >
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 bg-primary/50 group-active:bg-primary transition-opacity" />
          </div>
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
                className="p-2 rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
                aria-label={t('fileBrowser.close')}
                title={t('fileBrowser.close')}
              >
                <X className="h-5 w-5" />
              </button>
            </>
          )}
        />
      </div>
    </>
  )
}
