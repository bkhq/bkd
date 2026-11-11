import type { SubmitEvent } from "react";
import type { FmMountInfo } from "../core/schema";
import type { FmLabels } from "./labels";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function NameDialog({ title, initial, submitLabel, labels, onSubmit, onClose }: {
  title: string;
  initial: string;
  submitLabel: string;
  labels: FmLabels;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const valid = name.trim() !== "" && !/[/\\]/.test(name) && name !== "." && name !== "..";
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (valid)
      onSubmit(name.trim());
  };
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={title}
            value={name}
            onChange={e => setName(e.target.value)}
            onFocus={(e) => {
              const dot = initial.lastIndexOf(".");
              e.target.setSelectionRange(0, dot > 0
                ? dot
                : initial.length);
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{labels.cancel}</Button>
            <Button type="submit" disabled={!valid}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({ count, title, labels, onConfirm, onClose }: {
  count: number;
  title?: string;
  labels: FmLabels;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? labels.confirmDelete(count)}</AlertDialogTitle>
          <AlertDialogDescription>{labels.confirmDeleteHint}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>{labels.delete}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type FmUploadChoice = "overwrite" | "rename" | "skip";

/** Asked once per batch when uploads clash with existing names. */
export function UploadConflictDialog({ count, labels, onChoose, onClose }: {
  count: number;
  labels: FmLabels;
  onChoose: (choice: FmUploadChoice) => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.uploadConflict(count)}</AlertDialogTitle>
          <AlertDialogDescription>{labels.uploadConflictHint}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onChoose("skip")}>{labels.skip}</AlertDialogCancel>
          <AlertDialogAction variant="outline" onClick={() => onChoose("rename")}>{labels.keepBoth}</AlertDialogAction>
          <AlertDialogAction onClick={() => onChoose("overwrite")}>{labels.replace}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** One checkbox per mount (checked = visible); changes apply immediately. */
export function ManageDrivesDialog({ mounts, hidden, current, labels, onChange, onClose }: {
  mounts: FmMountInfo[];
  hidden: string[];
  current: string | undefined;
  labels: FmLabels;
  onChange: (hidden: string[]) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.manageDrives}</DialogTitle>
          <DialogDescription>{labels.manageDrivesHint}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {mounts.map(m => (
            <label key={m.id} className="flex items-center gap-2 text-sm has-disabled:opacity-60">
              <Checkbox
                checked={m.id === current || !hidden.includes(m.id)}
                disabled={m.id === current}
                onCheckedChange={on => onChange(on
                  ? hidden.filter(id => id !== m.id)
                  : [...hidden, m.id])}
              />
              {m.label}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>{labels.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
