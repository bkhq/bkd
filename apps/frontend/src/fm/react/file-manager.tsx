import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmChangeMessageOptions } from "./change-message";
import type { FmColumn, FmDetailTab } from "./columns";
import type { FmFeatures } from "./features";
import type { FmLabels } from "./labels";
import type { FmMeta } from "./meta";
import type { FmFileAction, FmPlugin } from "./plugins";
import { ManagerFrame } from "./manager-frame";
import { useFileManager } from "./use-file-manager";
import { WorkspaceShell } from "./workspace-shell";

export type { FmColumn, FmDetailTab } from "./columns";
export type { FmActionContext, FmFileAction, FmPlugin } from "./plugins";

export interface FmSidebarOptions {
  /** Mount ids left out of the tree and the storage menu (still reachable via `initialMount`). */
  hidden?: string[];
  /** `driver`: one section per driver kind. */
  group?: "none" | "driver";
  /**
   * `false` leaves the drives and "Manage drives" out of the tree, keeping only its sections
   * (Changes, Starred, Recent). With `features.starred` / `features.recent` off the tree shows changes only.
   */
  drives?: boolean;
}

export interface FmPickOptions {
  /** Extensions (`.png`) and MIME types (`image/*`); empty accepts every file. */
  accept?: string[];
  multiple?: boolean;
  /** Confirm is disabled while the selected files exceed this many bytes. */
  maxTotalSize?: number;
  onPick: (entries: FmEntry[]) => void;
  onCancel?: () => void;
}

export interface FileManagerProps {
  /** Router base URL (e.g. `/api/fm`); ignored when `client` is given. */
  baseUrl?: string;
  client?: FmClient;
  labels?: FmLabels;
  initialMount?: string;
  initialPath?: string;
  /** Extra actions for the entry context menu (share, attach …). */
  actions?: FmFileAction[];
  /** Optional extensions: previewers for more file types and their actions. */
  plugins?: FmPlugin[];
  className?: string;
  /** localStorage key prefix for the view / layout preferences. */
  storageKey?: string;
  /**
   * Initial layout: folder tree beside the list (`split`) or the list alone
   * (`single`). Users can toggle it on containers 640px and wider; narrower ones show
   * the tree or the open file one at a time (`split`) or the list (`single`).
   */
  layout?: "split" | "single";
  /** View-only preset: browse, preview, search and download. */
  readOnly?: boolean;
  /** Per-feature switches applied on top of `readOnly`, e.g. `{ delete: false }`. */
  features?: Partial<FmFeatures>;
  /** Sidebar drive visibility and grouping; users can hide more via "Manage drives". */
  sidebar?: FmSidebarOptions;
  /** Notes sent with every change (commit messages): asked by the manager or read from the host. */
  changeMessage?: FmChangeMessageOptions | undefined;
  /** Host-kept starred / recent entries; adds tree sections and a star action. */
  meta?: FmMeta | undefined;
  /** Host columns over `entry.extra` (list view, details, filters). */
  columns?: FmColumn[];
  /** Host tabs of the details panel (versions, shares, activity …). */
  detailTabs?: FmDetailTab[];
  /**
   * Pick mode, used by `FilePicker`: files are selected and confirmed instead of previewed.
   * @internal
   */
  pick?: FmPickOptions;
}

export function FileManager(props: FileManagerProps) {
  const fm = useFileManager(props);
  return (
    <ManagerFrame props={props} fm={fm}>
      <WorkspaceShell props={props} fm={fm} />
    </ManagerFrame>
  );
}
