import type { ComponentProps } from "react";
import { cn } from "cn";
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
