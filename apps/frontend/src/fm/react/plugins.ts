import type { ComponentType, ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { FmChangeEntry, FmEntry } from "../core/schema";
import type { FmLabels } from "./labels";
import type { FmPreviewer } from "./preview-registry";

/** What an action can do besides reading its targets. */
export interface FmActionContext {
  client: FmClient;
  /** Mount of the current folder. */
  mount: string;
  /** Current folder path. */
  path: string;
  /** Refetch listings after the action changed files. */
  refresh: () => Promise<void>;
  /** Open an entry in the preview dialog. */
  preview: (entry: FmEntry) => void;
  /** Show an error banner. */
  fail: (message: string) => void;
}

export interface FmFileAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown only when this returns true for the targeted entries. */
  when?: (entries: FmEntry[]) => boolean;
  run: (entries: FmEntry[], ctx: FmActionContext) => void | Promise<void>;
}

/**
 * Optional extension: previewers for more file types and context-menu
 * actions. Install one from the registry (e.g. `@bkhq/fm-plugin-sheet`) and
 * pass it with `<FileManager plugins={[sheetPlugin()]} />`.
 */
/** What a review view gets: the mount's changes, and optionally the one file to show. */
export interface FmReviewProps {
  client: FmClient;
  mount: string;
  labels: FmLabels;
  changes: readonly FmChangeEntry[];
  /** Show only this file's diff; all changes when absent. */
  path?: string | undefined;
  /** Slot in the header for the view's toolbar. */
  actions?: HTMLElement | null;
  /** Open the current version of a file in the manager. */
  onOpenFile: (path: string) => void;
}

export interface FmPlugin {
  id: string;
  previewers?: FmPreviewer[];
  actions?: FmFileAction[];
  /** Diff view for mounts with changes (one per manager; the first plugin providing it wins). */
  review?: ComponentType<FmReviewProps>;
}
