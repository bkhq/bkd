import type { ComponentProps } from "react";
import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Ghost icon button whose label doubles as aria-label and hover tooltip. */
export function IconButton({ label, size = "icon-sm", variant = "ghost", className, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      {/* Stays hoverable when disabled (aria-disabled instead of the native attribute) so the tooltip still shows. */}
      <TooltipTrigger render={<Button size={size} variant={variant} aria-label={label} focusableWhenDisabled className={cn("data-disabled:opacity-50", className)} {...props} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** One turn of Tailwind's `animate-spin`. */
const SPIN_MS = 1000;

/** Refresh icon button that spins until `onRefresh` settles, then finishes its current turn. */
export function RefreshButton({ label, onRefresh }: { label: string; onRefresh: () => Promise<unknown> }) {
  const [spinning, setSpinning] = useState(false);
  const refresh = () => {
    if (spinning)
      return;
    setSpinning(true);
    const start = Date.now();
    void onRefresh().finally(() => setTimeout(setSpinning, SPIN_MS - (Date.now() - start) % SPIN_MS, false));
  };
  return (
    <IconButton label={label} aria-busy={spinning} onClick={refresh}>
      <RefreshCwIcon className={cn(spinning && "animate-spin motion-reduce:animate-none")} />
    </IconButton>
  );
}
