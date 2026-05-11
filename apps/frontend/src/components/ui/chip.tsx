import type { ComponentProps, ReactNode } from 'react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Chip — pill-shaped toggle/control for toolbar configuration.
 *
 * Consumes the `.chip-surface` component class (defined in index.css)
 * so the surface treatment lives in one place. Dropdown/popover behavior
 * is intentionally NOT bundled — wrap the chip in `DropdownMenuTrigger`
 * or `PopoverTrigger` (Base UI's `render` prop) at the call site.
 *
 * Renders a real `<button>` by default so keyboard activation and form
 * a11y work out of the box. Pass `asDiv` for static info pills that
 * shouldn't be focusable. (PLAN-012 / UI-002)
 */
export interface ChipProps extends Omit<ComponentProps<'button'>, 'children'> {
  leading?: ReactNode
  trailing?: ReactNode
  /** Selected/highlighted treatment (e.g. open diff panel). */
  active?: boolean
  /** Render as a non-interactive `<div>` — for read-only status pills. */
  asDiv?: boolean
  children?: ReactNode
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { leading, trailing, active = false, asDiv = false, className, children, ...props },
  ref,
) {
  const content = (
    <>
      {leading ? <span className="shrink-0 inline-flex">{leading}</span> : null}
      {children ? <span className="truncate">{children}</span> : null}
      {trailing ? <span className="shrink-0 inline-flex">{trailing}</span> : null}
    </>
  )

  if (asDiv) {
    return (
      <div
        className={cn('chip-surface cursor-default', className)}
        data-active={active || undefined}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      ref={ref}
      type="button"
      className={cn('chip-surface', className)}
      data-active={active || undefined}
      {...props}
    >
      {content}
    </button>
  )
})

/**
 * ChipGroup — flex-wrap container with consistent gap. Use for toolbar
 * chip rows so the spacing isn't reinvented at every call site.
 */
export function ChipGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center gap-1 flex-wrap', className)}
      {...props}
    />
  )
}
