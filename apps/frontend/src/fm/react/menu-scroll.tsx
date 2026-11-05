import type { ReactNode } from "react";
import { cn } from "cn";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Scrolling body of a popup or panel list: a `ScrollArea` whose viewport stops at
 * `max-h-80` (or `max-h-60` with `short`). Popups using it drop their own
 * overflow and padding (`overflow-hidden p-0`).
 */
export function MenuScroll({ children, short, className }: { children: ReactNode; short?: boolean; className?: string }) {
  return (
    <ScrollArea
      className={cn(short
        ? "[&>[data-slot=scroll-area-viewport]]:max-h-60"
        : "[&>[data-slot=scroll-area-viewport]]:max-h-80", className)}
    >
      <div className="p-1">{children}</div>
    </ScrollArea>
  );
}
