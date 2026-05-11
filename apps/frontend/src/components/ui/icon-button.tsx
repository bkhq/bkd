import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

/**
 * IconButton — semantic wrapper over `<Button variant="ghost" size="icon-*">`.
 *
 * Maps the project's 4-tier control scale to friendlier names. Adds an
 * `active` prop that swaps the surface to the "selected" treatment so
 * toolbar buttons (e.g. "diff panel open") don't need to invent their
 * own bg-primary/10 className each time. (PLAN-012 / UI-002)
 *
 * Defaults: `size="sm"` (28px) / `variant="ghost"` — matches the
 * pre-refactor `<Button variant="ghost" size="icon" className="size-7">`
 * pattern that was duplicated across ChatInput and the kanban header.
 */
type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'
type IconButtonVariant = 'ghost' | 'subtle' | 'primary' | 'destructive'

const SIZE_MAP: Record<IconButtonSize, ComponentProps<typeof Button>['size']> = {
  xs: 'icon-xs',
  sm: 'icon-sm',
  md: 'icon',
  lg: 'icon-lg',
}

const VARIANT_MAP: Record<IconButtonVariant, ComponentProps<typeof Button>['variant']> = {
  ghost: 'ghost',
  subtle: 'secondary',
  primary: 'default',
  destructive: 'destructive',
}

export interface IconButtonProps extends Omit<ComponentProps<typeof Button>, 'size' | 'variant'> {
  size?: IconButtonSize
  variant?: IconButtonVariant
  /** Selected/pressed visual state. Maps to aria-pressed + surface tint. */
  active?: boolean
}

export function IconButton({
  size = 'sm',
  variant = 'ghost',
  active = false,
  className,
  ...props
}: IconButtonProps) {
  return (
    <Button
      size={SIZE_MAP[size]}
      variant={VARIANT_MAP[variant]}
      aria-pressed={active || undefined}
      className={cn(
        active && variant === 'ghost' && 'bg-accent text-foreground',
        className,
      )}
      {...props}
    />
  )
}
