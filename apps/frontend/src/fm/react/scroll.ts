import type { RefObject } from "react";

/**
 * Callback ref for a shadcn `ScrollArea` root that stores its viewport (the element that
 * actually scrolls) in `ref`, for virtualizers and scroll-into-view code.
 */
export function viewportRef<T extends HTMLElement>(ref: RefObject<T | null>) {
  return (root: HTMLDivElement | null) => {
    ref.current = root?.querySelector<T>("[data-slot=scroll-area-viewport]") ?? null;
  };
}
