import type { RefObject } from "react";

/**
 * Callback ref for a shadcn `ScrollArea` root that stores its viewport (the element that
 * actually scrolls) in `ref`, for virtualizers and scroll-into-view code. Pass a state setter
 * when the viewport is read by a descendant: an ancestor's ref is attached after its children's
 * layout effects, so a plain ref is still null on their first commit.
 */
export function viewportRef<T extends HTMLElement>(ref: RefObject<T | null> | ((viewport: T | null) => void)) {
  return (root: HTMLDivElement | null) => {
    const viewport = root?.querySelector<T>("[data-slot=scroll-area-viewport]") ?? null;
    if (typeof ref === "function")
      ref(viewport);
    else
      ref.current = viewport;
  };
}
