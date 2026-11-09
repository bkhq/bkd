import type { FmLabels } from "./labels";
import { Maximize2Icon, Minimize2Icon } from "lucide-react";
import { IconButton } from "./icon-button";

/** `DialogContent` classes that make a dialog fill the browser window. */
export const MAXIMIZED_DIALOG = "inset-0 size-full max-w-none translate-x-0 translate-y-0 rounded-none sm:max-w-none";

export function MaximizeButton({ maximized, labels, onToggle }: { maximized: boolean; labels: FmLabels; onToggle: () => void }) {
  return (
    <IconButton label={maximized ? labels.exitFullScreen : labels.fullScreen} aria-pressed={maximized} onClick={onToggle}>
      {maximized
        ? <Minimize2Icon />
        : <Maximize2Icon />}
    </IconButton>
  );
}
