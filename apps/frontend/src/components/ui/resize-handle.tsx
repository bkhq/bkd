import { useRef } from 'react'
import { cn } from '@/lib/utils'

/** Which edge of the panel the handle sits on. */
export type ResizeEdge = 'left' | 'right'

/** Keyboard step, and the step used while shift is held. */
const STEP = 10
const SHIFT_STEP = 50

/**
 * Drag handle for resizable panels and drawers.
 *
 * Reports candidate widths and leaves clamping to the caller, which already
 * owns it — the panel stores clamp inside `setWidth`, and the list pages clamp
 * against a maximum that depends on what else is on screen. `min`/`max` are the
 * bounds reported to assistive technology.
 */
export function ResizeHandle({
  width,
  onWidthChange,
  min,
  max,
  label,
  edge = 'left',
  className,
}: {
  width: number
  onWidthChange: (width: number) => void
  min: number
  max: number
  label: string
  edge?: ResizeEdge
  className?: string
}) {
  const dragRef = useRef<{ startX: number, startWidth: number } | null>(null)

  // A handle on the left edge grows the panel when dragged left; one on the
  // right edge grows it when dragged right.
  const direction = edge === 'left' ? -1 : 1

  const endDrag = () => {
    dragRef.current = null
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cn(
        'group absolute inset-y-0 z-10 w-2 cursor-col-resize select-none outline-none',
        edge === 'left' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
        className,
      )}
      // Panels sometimes sit inside click-to-dismiss containers; the handle
      // must never be mistaken for a click on the panel behind it.
      onClick={e => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = { startX: e.clientX, startWidth: width }
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return
        const delta = (e.clientX - dragRef.current.startX) * direction
        onWidthChange(dragRef.current.startWidth + delta)
      }}
      onPointerUp={endDrag}
      // Without this a cancelled pointer (scroll takeover, context menu, window
      // blur) leaves the drag latched until the next pointerup.
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={(e) => {
        const step = e.shiftKey ? SHIFT_STEP : STEP
        const grow = edge === 'left' ? 'ArrowLeft' : 'ArrowRight'
        const shrink = edge === 'left' ? 'ArrowRight' : 'ArrowLeft'
        if (e.key === grow) {
          e.preventDefault()
          onWidthChange(width + step)
        }
        if (e.key === shrink) {
          e.preventDefault()
          onWidthChange(width - step)
        }
      }}
    >
      <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-primary/50 opacity-0 transition-opacity group-hover:opacity-100 group-active:bg-primary group-active:opacity-100" />
    </div>
  )
}
