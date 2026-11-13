import type { RefObject } from 'react'

/**
 * Callback ref for a `ScrollArea` root that stores its viewport (the element that
 * actually scrolls) in `ref`.
 */
export function viewportRef<T extends HTMLElement>(ref: RefObject<T | null>) {
  return (root: HTMLDivElement | null) => {
    ref.current = root?.querySelector<T>('[data-slot=scroll-area-viewport]') ?? null
  }
}
