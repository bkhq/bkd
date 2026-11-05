import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmLabels } from "./labels";
import { useState } from "react";
import { createFmClient } from "../client/client";
import { useMounts } from "../client/hooks";
import { VIEW_ONLY_FEATURES } from "./features";
import { FileManager } from "./file-manager";

export interface FilePickerProps {
  /** Router base URL (e.g. `/api/fm`); ignored when `client` is given. */
  baseUrl?: string;
  client?: FmClient;
  /** Mount ids to offer; defaults to all. */
  mounts?: string[];
  initialMount?: string;
  initialPath?: string;
  /** Extensions (`.png`) and MIME types (`image/*`); other files are shown disabled. */
  accept?: string[];
  multiple?: boolean;
  /** Maximum total size of the picked files in bytes. */
  maxTotalSize?: number;
  onPick: (entries: FmEntry[]) => void;
  onCancel?: () => void;
  labels?: FmLabels;
  className?: string;
  /** localStorage key prefix for the view / layout preferences. */
  storageKey?: string;
}

/** Browses mounts and lets the user pick files. */
export function FilePicker(props: FilePickerProps) {
  const [client] = useState(() => props.client ?? createFmClient({ baseUrl: props.baseUrl ?? "/api/fm" }));
  const all = useMounts(client).data;
  const hidden = props.mounts && all
    ? all.filter(m => !props.mounts!.includes(m.id)).map(m => m.id)
    : [];
  const initialMount = props.initialMount ?? props.mounts?.[0];
  return (
    <FileManager
      client={client}
      features={VIEW_ONLY_FEATURES}
      layout="single"
      storageKey={props.storageKey ?? "fm-picker"}
      sidebar={{ hidden }}
      {...(initialMount
        ? { initialMount }
        : {})}
      {...(props.initialPath
        ? { initialPath: props.initialPath }
        : {})}
      {...(props.labels
        ? { labels: props.labels }
        : {})}
      {...(props.className
        ? { className: props.className }
        : {})}
      pick={{
        onPick: props.onPick,
        ...(props.accept
          ? { accept: props.accept }
          : {}),
        ...(props.multiple
          ? { multiple: true }
          : {}),
        ...(props.maxTotalSize !== undefined
          ? { maxTotalSize: props.maxTotalSize }
          : {}),
        ...(props.onCancel
          ? { onCancel: props.onCancel }
          : {}),
      }}
    />
  );
}
