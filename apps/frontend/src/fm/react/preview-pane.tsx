import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmLabels } from "./labels";
import type { FmPreviewer } from "./preview-registry";
import { createElement, Suspense } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { findPreviewer } from "./preview-registry";

/** The previewer for `entry`; read-only unless `editable`. Used by the dialog and the inline pane. */
export function PreviewBody({ entry, client, labels, editable, previewers, actions, onDirtyChange }: {
  entry: FmEntry;
  client: FmClient;
  labels: FmLabels;
  editable: boolean;
  /** Plugin previewers, considered next to the registered ones. */
  previewers?: readonly FmPreviewer[] | undefined;
  /** Element the previewer may portal header buttons into. */
  actions: HTMLElement | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const shown = editable
    ? entry
    : {
        ...entry,
        caps: { ...entry.caps, write: false },
      };
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">{labels.loading}</div>}>
      {createElement(findPreviewer(entry, previewers), {
        key: entry.path,
        entry: shown,
        client,
        labels,
        actions,
        onDirtyChange,
      })}
    </Suspense>
  );
}

/** Confirms discarding unsaved edits before `onDiscard` continues. */
export function DiscardChangesDialog({ labels, onCancel, onDiscard }: {
  labels: FmLabels;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={o => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.discardChanges}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDiscard}>{labels.discard}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
