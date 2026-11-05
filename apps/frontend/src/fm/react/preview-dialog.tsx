import type { KeyboardEvent } from "react";
import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmLabels } from "./labels";
import type { FmPreviewer } from "./preview-registry";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clearDraft } from "./drafts";
import { IconButton } from "./icon-button";
import { DiscardChangesDialog, PreviewBody } from "./preview-pane";

/** Preview of `entry` with previous / next over `siblings` and a guard against losing unsaved edits. */
export function PreviewDialog({ entry, siblings, client, labels, editable, previewers, onNavigate, onDownload, onClose }: {
  entry: FmEntry;
  /** Files in display order. */
  siblings: FmEntry[];
  client: FmClient;
  labels: FmLabels;
  editable: boolean;
  /** Plugin previewers, considered next to the registered ones. */
  previewers?: readonly FmPreviewer[];
  onNavigate: (entry: FmEntry) => void;
  /** Omit to hide the download button. */
  onDownload?: (entry: FmEntry) => void;
  onClose: () => void;
}) {
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<() => void>();

  const guard = (fn: () => void) => (dirty
    ? setPending(() => fn)
    : fn());
  const index = siblings.findIndex(s => s.path === entry.path);
  const prev = index > 0
    ? siblings[index - 1]
    : undefined;
  const next = index >= 0
    ? siblings[index + 1]
    : undefined;
  const go = (target: FmEntry | undefined) => target && guard(() => onNavigate(target));

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]"))
      return;
    if (e.key === "ArrowLeft")
      go(prev);
    else if (e.key === "ArrowRight")
      go(next);
  };

  return (
    <>
      <Dialog open onOpenChange={o => !o && guard(onClose)}>
        <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-5xl" onKeyDown={onKeyDown}>
          <DialogHeader className="flex-row items-center gap-2 border-b py-2 pr-12 pl-4">
            <DialogTitle className="min-w-0 flex-1 truncate">{entry.name}</DialogTitle>
            <div ref={setActions} className="flex items-center gap-2" />
            {onDownload && <IconButton label={labels.download} onClick={() => onDownload(entry)}><DownloadIcon /></IconButton>}
            {siblings.length > 1 && (
              <>
                <IconButton label={labels.previous} disabled={!prev} onClick={() => go(prev)}><ChevronLeftIcon /></IconButton>
                <IconButton label={labels.next} disabled={!next} onClick={() => go(next)}><ChevronRightIcon /></IconButton>
              </>
            )}
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <PreviewBody entry={entry} client={client} labels={labels} editable={editable} previewers={previewers} actions={actions} onDirtyChange={setDirty} />
          </div>
        </DialogContent>
      </Dialog>
      {pending && (
        <DiscardChangesDialog
          labels={labels}
          onCancel={() => setPending(undefined)}
          onDiscard={() => {
            setPending(undefined);
            setDirty(false);
            pending();
            // After the editor's unmount flush, so the draft does not come back.
            setTimeout(clearDraft, 0, entry.mount, entry.path);
          }}
        />
      )}
    </>
  );
}
