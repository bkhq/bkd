import type { ComponentType } from "react";
import type { FmLabels } from "./labels";
import type { FmReviewProps } from "./plugins";
import { cn } from "cn";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaximizeButton, MAXIMIZED_DIALOG } from "./dialog-maximize";

/** The review plugin's view, inline (explorer pane). */
export function ReviewView({ reviewer: Reviewer, ...props }: FmReviewProps & { reviewer: ComponentType<FmReviewProps> }) {
  return <Reviewer {...props} />;
}

/** The review view in a dialog, for layouts without a preview pane. */
export function ReviewDialog({ reviewer: Reviewer, labels, title, onClose, ...props }: Omit<FmReviewProps, "actions"> & {
  reviewer: ComponentType<FmReviewProps>;
  labels: FmLabels;
  title: string;
  onClose: () => void;
}) {
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [maximized, setMaximized] = useState(false);
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className={cn("flex flex-col gap-0 p-0 transition-none", maximized ? MAXIMIZED_DIALOG : "h-[85vh] sm:max-w-6xl")}>
        <DialogHeader className="flex-row items-center gap-2 border-b px-4 py-2 pr-12">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm">{title}</DialogTitle>
          <div ref={setActions} className="flex items-center gap-1" />
          <MaximizeButton maximized={maximized} labels={labels} onToggle={() => setMaximized(!maximized)} />
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <Reviewer {...props} labels={labels} actions={actions} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
