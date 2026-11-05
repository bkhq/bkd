import type { FmUploadQueue } from "../client/upload";
import type { FmLabels } from "./labels";
import { CheckIcon, XIcon } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { IconButton } from "./icon-button";
import { MenuScroll } from "./menu-scroll";

/** Floating panel listing in-flight and finished uploads. */
export function UploadPanel({ queue, labels }: { queue: FmUploadQueue; labels: FmLabels }) {
  const tasks = useStore(queue, s => s.tasks);
  const { cancel, clearFinished } = queue.getState();
  if (tasks.length === 0)
    return null;
  return (
    <div className="absolute right-3 bottom-3 z-20 w-80 max-w-[calc(100%-1.5rem)] rounded-lg border bg-popover text-popover-foreground shadow-lg" role="status" aria-label={labels.uploads}>
      <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-medium">
        {labels.uploads}
        <Button size="sm" variant="ghost" onClick={clearFinished}>{labels.clearFinished}</Button>
      </div>
      <MenuScroll short>
        <ul className="px-1 text-xs">
          {tasks.map(t => (
            <li key={t.id} className="flex items-center gap-2 py-1" data-status={t.status}>
              <div className="min-w-0 flex-1">
                <div className="truncate" title={t.path}>{t.name}</div>
                {t.status === "uploading" && (
                  <Progress value={t.size
                    ? (t.loaded / t.size) * 100
                    : 0}
                  />
                )}
                {t.status === "error" && <div className="truncate text-destructive" title={t.error}>{t.error}</div>}
                {t.status === "canceled" && <div className="text-muted-foreground">{labels.cancel}</div>}
              </div>
              {t.status === "done"
                ? <CheckIcon className="size-4 text-emerald-500" />
                : (t.status === "queued" || t.status === "uploading") && (
                    <IconButton size="icon-xs" label={labels.cancel} onClick={() => cancel(t.id)}>
                      <XIcon />
                    </IconButton>
                  )}
            </li>
          ))}
        </ul>
      </MenuScroll>
    </div>
  );
}
