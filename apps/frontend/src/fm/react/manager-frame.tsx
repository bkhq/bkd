import type { ReactNode } from "react";
import type { FileManagerProps } from "./file-manager";
import type { FmController } from "./use-file-manager";
import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChangeMessageContext } from "./change-message";
import { ManagerOverlays } from "./manager-overlays";

/** Root of a manager shell: unreachable / empty states, the container, dialogs and overlays. */
export function ManagerFrame({ props, fm, children }: { props: Pick<FileManagerProps, "className">; fm: FmController; children: ReactNode }) {
  const { labels, changeMessage, mounts, rootRef, onPasteFiles } = fm;

  if (!mounts.data && mounts.isError) {
    return (
      <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center text-sm", props.className)}>
        <div className="font-medium">{labels.serverUnreachable}</div>
        <div className="text-xs text-muted-foreground">{mounts.error.message}</div>
        <Button size="sm" variant="outline" disabled={mounts.isFetching} onClick={() => void mounts.refetch()}>
          <RefreshCwIcon />
          {labels.retry}
        </Button>
      </div>
    );
  }

  if (mounts.data && mounts.data.length === 0)
    return <div className={cn("p-6 text-sm text-muted-foreground", props.className)}>{labels.noMounts}</div>;

  return (
    <ChangeMessageContext value={changeMessage.value}>
      <div ref={rootRef} className={cn("relative flex h-full min-h-0 overflow-hidden rounded-lg border bg-background", props.className)} onPaste={onPasteFiles}>
        {children}
        <ManagerOverlays fm={fm} />
      </div>
    </ChangeMessageContext>
  );
}
