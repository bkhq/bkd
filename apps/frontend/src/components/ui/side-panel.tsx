import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ResizeHandle } from '@/components/ui/resize-handle'
import { cn } from '@/lib/utils'

/**
 * Icon button for panel headers. Denser than the shadcn icon default, which is
 * sized for form rows.
 */
export function SidePanelButton({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  destructive?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn('h-6 w-6 text-muted-foreground', destructive && 'hover:text-destructive')}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  )
}

/** The minimize / fullscreen / close trio every drawer header ends with. */
export function SidePanelActions({
  isFullscreen,
  onToggleFullscreen,
  fullscreenLabel,
  restoreLabel,
  onMinimize,
  minimizeLabel,
  onClose,
  closeLabel,
  closeIcon = X,
  destructiveClose,
}: {
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  fullscreenLabel?: string
  restoreLabel?: string
  onMinimize?: () => void
  minimizeLabel?: string
  onClose: () => void
  closeLabel: string
  closeIcon?: LucideIcon
  destructiveClose?: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      {onMinimize
        ? <SidePanelButton icon={Minus} label={minimizeLabel ?? ''} onClick={onMinimize} />
        : null}
      {onToggleFullscreen
        ? (
            <SidePanelButton
              icon={isFullscreen ? Minimize2 : Maximize2}
              label={(isFullscreen ? restoreLabel : fullscreenLabel) ?? ''}
              onClick={onToggleFullscreen}
            />
          )
        : null}
      <SidePanelButton
        icon={closeIcon}
        label={closeLabel}
        onClick={onClose}
        destructive={destructiveClose}
      />
    </div>
  )
}

/**
 * Right-side drawer shell: backdrop, panel, resize handle and optional header.
 *
 * `fullscreen` is the resolved value — callers decide whether that means the
 * user toggled it or the viewport is small. Omit `title` when the children
 * render their own header; pass `SidePanelActions` into that header instead.
 */
export function SidePanel({
  label,
  width,
  onWidthChange,
  minWidth,
  maxWidth,
  resizeLabel,
  fullscreen,
  onClose,
  title,
  actions,
  footer,
  children,
}: {
  label: string
  width: number
  onWidthChange: (width: number) => void
  minWidth: number
  maxWidth: number
  resizeLabel: string
  fullscreen: boolean
  onClose: () => void
  title?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <>
      {fullscreen
        ? null
        : <div aria-hidden="true" className="fixed inset-0 z-[39] bg-black/20" onClick={onClose} />}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-background shadow-2xl',
          fullscreen && 'left-0',
        )}
        style={fullscreen ? undefined : { width }}
      >
        {fullscreen
          ? null
          : (
              <ResizeHandle
                width={width}
                onWidthChange={onWidthChange}
                min={minWidth}
                max={maxWidth}
                label={resizeLabel}
              />
            )}

        {title
          ? (
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">{title}</div>
                {actions}
              </div>
            )
          : null}

        {children}

        {footer
          ? <div className="shrink-0 border-t border-border">{footer}</div>
          : null}
      </div>
    </>
  )
}
