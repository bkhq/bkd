import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { FmUploadFile, FmUploadTask } from "../client/upload";
import type { FmEntry, FmOpsRequest, FmSortKey } from "../core/schema";
import type { FmChangeMessageOptions } from "./change-message";
import type { FmFeatures } from "./features";
import type { FmTreeTarget } from "./file-tree";
import type { FmListFilters } from "./filters";
import type { FmLabels } from "./labels";
import type { FmMeta } from "./meta";
import type { FmActionContext, FmFileAction, FmPlugin } from "./plugins";
import type { FmClipboard, FmSelection, FmSelectMode } from "./state";
import type { FmMenuItems } from "./tidy-menu";
import type { FmUndo } from "./undo";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ClipboardCopyIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  DownloadIcon,
  EllipsisIcon,
  EyeIcon,
  FilePlusIcon,
  FileSearchIcon,
  FilterIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderUpIcon,
  GitCompareIcon,
  HistoryIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  PanelLeftIcon,
  PencilIcon,
  RefreshCwIcon,
  ScissorsIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useDefaultLayout } from "react-resizable-panels";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createFmClient, FmApiError } from "../client/client";
import { changesQuery, fmKeys, useFmMutations, useListing, useMounts, useSearch, useTrash } from "../client/hooks";
import { createUploadQueue, xhrTransport } from "../client/upload";
import { basename, dirname, isWithin, joinPath } from "../core/path";
import { READ_ONLY_CAPS } from "../core/schema";
import { acceptsEntry } from "./accept";
import { ChangeMessageContext, useChangeMessageState } from "./change-message";
import { ChangeMessageDialog } from "./change-message-dialog";
import { indexChanges } from "./changes";
import { DetailsPanel } from "./details-panel";
import { ConfirmDeleteDialog, ManageDrivesDialog, NameDialog, UploadConflictDialog } from "./dialogs";
import { clearDraft, clearDrafts } from "./drafts";
import { filesFromDropzone, filesFromInput } from "./drop";
import { maskEntry, resolveFeatures } from "./features";
import { EntryIcon, FileList } from "./file-list";
import { FileTree } from "./file-tree";
import { FilterChips, FilterMenuItems } from "./filter-menu";
import { applyFilters, hasFilters, NO_FILTERS, parseFilters } from "./filters";
import { IconButton } from "./icon-button";
import { enLabels } from "./labels";
import { MenuScroll } from "./menu-scroll";
import { metaKey, useMetaEntries } from "./meta";
import { groupMountsByDriver, parseHidden, visibleMounts } from "./mount-visibility";
import { PathBar } from "./path-bar";
import { PreviewDialog } from "./preview-dialog";
import { DiscardChangesDialog, PreviewBody } from "./preview-pane";
import { QuickOpen } from "./quick-open";
import { ReviewDialog, ReviewView } from "./review-dialog";
import { viewportRef } from "./scroll";
import { EMPTY_SELECTION, formatSize, kindOf, prune, select, step } from "./state";
import { tidyMenu } from "./tidy-menu";
import { TrashView } from "./trash-view";
import { undoFor } from "./undo";
import { UploadPanel } from "./upload-panel";

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
  /**
   * Pick mode, used by `FilePicker`: files are selected and confirmed instead of previewed.
   * @internal
   */
  pick?: FmPickOptions;
}

/** A folder that an action targets instead of the current one. */
interface FolderRef {
  mount: string;
  path: string;
}

type DialogState
  = | { kind: "mkdir"; to?: FolderRef }
    | { kind: "rename"; entry: FmEntry }
    | { kind: "delete"; paths: string[]; mount: string; after?: () => void }
    | { kind: "newFile"; to?: FolderRef }
    | { kind: "emptyTrash" }
    | { kind: "manageDrives" }
    | { kind: "uploadConflict"; files: FmUploadFile[]; clashes: Set<string>; to: FolderRef }
    | undefined;

/** First path segment of an upload below the target folder. */
const topName = (f: FmUploadFile) => (f.relativePath || f.file.name).replace(/^\/+/, "").split("/")[0]!;

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
}

/** A string choice persisted in localStorage. */
function useStoredChoice<T extends string>(key: string, values: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = typeof localStorage !== "undefined"
      ? localStorage.getItem(key)
      : null;
    return values.find(v => v === stored) ?? fallback;
  });
  const change = (v: T) => {
    setValue(v);
    localStorage.setItem(key, v);
  };
  return [value, change] as const;
}

/** A list of strings persisted in localStorage as JSON. */
function useStoredList(key: string) {
  const [value, setValue] = useState(() => parseHidden(typeof localStorage !== "undefined"
    ? localStorage.getItem(key)
    : null));
  const change = (v: string[]) => {
    setValue(v);
    localStorage.setItem(key, JSON.stringify(v));
  };
  return [value, change] as const;
}

/** List filters per mount, persisted in localStorage under `prefix:mount`. */
function useStoredFilters(prefix: string) {
  const [byMount, setByMount] = useState<Readonly<Record<string, FmListFilters>>>({});
  const get = useCallback((m: string | undefined) => {
    if (!m)
      return NO_FILTERS;
    return byMount[m] ?? (typeof localStorage !== "undefined"
      ? parseFilters(localStorage.getItem(`${prefix}:${m}`))
      : NO_FILTERS);
  }, [byMount, prefix]);
  const set = (m: string, f: FmListFilters) => {
    setByMount(all => ({ ...all, [m]: f }));
    localStorage.setItem(`${prefix}:${m}`, JSON.stringify(f));
  };
  return [get, set] as const;
}

/** Tree rows that the location opens: its mount and, outside the trash, every ancestor folder. */
function onPathKeys(mount: string, path: string, trash: boolean) {
  const keys = [`${mount}:/`];
  if (!trash) {
    for (let p = dirname(path); p !== "/"; p = dirname(p))
      keys.push(`${mount}:${p}`);
  }
  return keys;
}

/** The remembered `{ mount, path, file? }`, if it parses. */
function readLast(key: string) {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (v && typeof v === "object" && "mount" in v && "path" in v && typeof v.mount === "string" && typeof v.path === "string") {
      return {
        mount: v.mount,
        path: v.path,
        file: "file" in v && typeof v.file === "string"
          ? v.file
          : undefined,
      };
    }
  }
  catch {}
  return undefined;
}

const NARROW = 640;

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
/** Shortcut labels shown in context menus; they mirror the list's key handler. */
const KEYS = {
  open: MAC
    ? "↩"
    : "Enter",
  copy: MAC
    ? "⌘C"
    : "Ctrl+C",
  cut: MAC
    ? "⌘X"
    : "Ctrl+X",
  paste: MAC
    ? "⌘V"
    : "Ctrl+V",
  rename: "F2",
  delete: MAC
    ? "⌦"
    : "Del",
};

/** Width of an element, tracked with ResizeObserver (0 until measured). */
function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el)
      return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

export function FileManager(props: FileManagerProps) {
  const labels = props.labels ?? enLabels;
  // A host-owned note (`changeMessage.get`) rides on every change of the built-in client;
  // hosts passing `client` set `message` on it themselves.
  const changeMessageRef = useRef(props.changeMessage);
  changeMessageRef.current = props.changeMessage;
  const [client] = useState(() => props.client ?? createFmClient({
    baseUrl: props.baseUrl ?? "/api/fm",
    message: () => {
      const o = changeMessageRef.current;
      return o && "get" in o
        ? o.get()
        : undefined;
    },
  }));
  const changeMessage = useChangeMessageState(props.changeMessage);
  const { ask, used } = changeMessage.value;
  const qc = useQueryClient();
  const mounts = useMounts(client);
  const pluginPreviewers = useMemo(() => (props.plugins ?? []).flatMap(p => p.previewers ?? []), [props.plugins]);
  const features = useMemo(() => resolveFeatures(props.readOnly, props.features), [props.readOnly, props.features]);
  const [location, setLocation] = useState({ mount: props.initialMount, path: props.initialPath ?? "/", trash: false });
  const storageKey = props.storageKey ?? "fm";
  const hostHidden = props.sidebar?.hidden ?? [];
  const [userHidden, setUserHidden] = useStoredList(`${storageKey}:hidden`);
  const mount = location.mount ?? (mounts.data && (visibleMounts(mounts.data, hostHidden, userHidden, undefined)[0] ?? mounts.data[0]))?.id;
  const shownMounts = mounts.data && visibleMounts(mounts.data, hostHidden, userHidden, mount);
  // Manage drives picks which drives to show, which means nothing with only one.
  const canManageDrives = !!mounts.data && visibleMounts(mounts.data, hostHidden, [], undefined).length > 1;
  const { path, trash: inTrash } = location;
  // Expanded tree rows; a new location opens the rows on its path that were not on the previous one.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [pathRows, setPathRows] = useState<{ at?: string | undefined; keys: ReadonlySet<string> }>(() => ({
    keys: new Set(),
  }));
  const at = mount && `${mount}:${path}:${inTrash}`;
  if (mount && at !== pathRows.at) {
    const keys = onPathKeys(mount, path, inTrash);
    const added = keys.filter(k => !pathRows.keys.has(k));
    setPathRows({
      at,
      keys: new Set(keys),
    });
    if (added.length) {
      setExpanded(s => new Set([
        ...s,
        ...added,
      ]));
    }
  }
  const setRowExpanded = (key: string, open: boolean) => setExpanded((s) => {
    const next = new Set(s);
    if (open)
      next.add(key);
    else
      next.delete(key);
    return next;
  });
  const collapseAll = () => {
    setExpanded(new Set());
    // The next location reopens its whole path.
    setPathRows(r => ({
      ...r,
      keys: new Set(),
    }));
  };
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"folder" | "below">("folder");
  const [view, setView] = useStoredChoice(`${storageKey}:view`, ["list", "grid"], "list");
  const [layout, setLayout] = useStoredChoice(`${storageKey}:layout`, ["split", "single"], props.layout ?? "split");
  const [hiddenFiles, setHiddenFiles] = useStoredChoice(`${storageKey}:hidden-files`, ["on", "off"], "off");
  const [ignoredFiles, setIgnoredFiles] = useStoredChoice(`${storageKey}:ignored-files`, ["on", "off"], "on");
  const showHidden = hiddenFiles === "on";
  const showIgnored = ignoredFiles === "on";
  const filter = useMemo(() => ({ hidden: showHidden, ignored: showIgnored }), [showHidden, showIgnored]);
  const [rootRef, width] = useWidth();
  const narrow = width > 0 && width < NARROW;
  // Narrow containers show the tree or the main pane, one at a time; the picker keeps the list.
  const stacked = narrow && layout === "split" && !props.pick;
  const split = layout === "split" && (!narrow || stacked);
  const [narrowPane, setNarrowPane] = useState<"tree" | "main">("tree");
  const treeOnly = stacked && narrowPane === "tree";
  const [sort, setSort] = useState<{ key: FmSortKey; order: "asc" | "desc" }>({ key: "name", order: "asc" });
  const [rawSelection, setRawSelection] = useState<FmSelection>(EMPTY_SELECTION);
  const [clipboard, setClipboard] = useState<FmClipboard>();
  const [preview, setPreview] = useState<FmEntry>();
  const [dialog, setDialog] = useState<DialogState>();
  const [quickOpen, setQuickOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<{ message: string; undo?: () => void }>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Unsaved edits in the inline preview; navigation asks before discarding them.
  const paneDirtyRef = useRef(false);
  const [pendingNav, setPendingNav] = useState<() => void>();
  const [paneActions, setPaneActions] = useState<HTMLElement | null>(null);
  const guard = useCallback((fn: () => void) => {
    if (paneDirtyRef.current)
      setPendingNav(() => fn);
    else
      fn();
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Set by the tree row before its context menu opens; read once by the trigger.
  const treeTargetRef = useRef<FmTreeTarget | undefined>(undefined);
  const [treeTarget, setTreeTarget] = useState<FmTreeTarget>();
  const folderInputRef = useRef<HTMLInputElement>(null);
  // Target folder of the next file picker upload; unset uploads into the current folder.
  const uploadToRef = useRef<FolderRef | undefined>(undefined);

  // Folders created on mounts whose folders are implied by file paths (`implicitFolders`):
  // kept here, merged into listings, until a file lands in them or they go away.
  const [pendingFolders, setPendingFolders] = useState<ReadonlyMap<string, ReadonlySet<string>>>(() => new Map());
  const pendingIn = useCallback((m: string, parent: string): FmEntry[] => {
    const info = mounts.data?.find(x => x.id === m);
    return [
      ...pendingFolders.get(m) ?? [],
    ].filter(p => dirname(p) === parent).map(p => ({
      mount: m,
      path: p,
      name: basename(p),
      kind: "dir",
      size: 0,
      mtime: new Date(0).toISOString(),
      etag: "",
      caps: info?.caps ?? READ_ONLY_CAPS,
    }));
  }, [pendingFolders, mounts.data]);
  const isPending = (m: string | undefined, p: string) => !!m && !!pendingFolders.get(m)?.has(p);
  const addPendingFolder = (m: string, p: string) => {
    if (mounts.data?.find(x => x.id === m)?.implicitFolders) {
      setPendingFolders(all => new Map(all).set(m, new Set([
        ...all.get(m) ?? [],
        p,
      ])));
    }
  };
  /** Drops pending folders at or below `paths` (deleted, renamed, moved away). */
  const dropPendingFolders = (m: string, paths: readonly string[]) => setPendingFolders((all) => {
    const set = all.get(m);
    if (!set)
      return all;
    const kept = [...set].filter(p => !paths.some(gone => isWithin(p, gone)));
    return kept.length === set.size
      ? all
      : new Map(all).set(m, new Set(kept));
  });
  const withPending = (m: string, parent: string, es: readonly FmEntry[]) => {
    const extra = pendingIn(m, parent).filter(f => !es.some(e => e.path === f.path));
    return extra.length
      ? [
          ...es,
          ...extra,
        ]
      : es;
  };

  const listing = useListing(client, mount, path, sort.key, sort.order, query.trim(), filter);
  const below = features.search && searchScope === "below" && !!query.trim();
  const search = useSearch(client, mount, path, query.trim(), below, "substring", filter);
  const items = useMemo(() => (below
    ? search.data?.items
    : listing.data?.pages.flatMap(p => p.items)), [below, search.data, listing.data]);
  const [filtersFor, setFiltersFor] = useStoredFilters(`${storageKey}:filters`);
  const filters = filtersFor(mount);
  const changeFilters = (f: FmListFilters) => mount && setFiltersFor(mount, f);
  // A pending folder the driver does not know yet lists as empty.
  const pendingHere = isPending(mount, path) && listing.error instanceof FmApiError && listing.error.status === 404;
  const unfiltered = useMemo(() => {
    const own = (items ?? []).map(e => maskEntry(e, features));
    return mount && !below && !query.trim()
      ? withPending(mount, path, own)
      : own;
  // eslint-disable-next-line react/exhaustive-deps -- `withPending` reads `pendingIn`.
  }, [
    items,
    features,
    mount,
    path,
    below,
    query,
    pendingIn,
  ]);
  const entries = useMemo(() => applyFilters(unfiltered, filters), [unfiltered, filters]);
  const treeFilter = useCallback((m: string, es: readonly FmEntry[], parent: string) => {
    const extra = pendingIn(m, parent).filter(f => !es.some(e => e.path === f.path));
    return applyFilters(extra.length
      ? [
          ...es,
          ...extra,
        ]
      : es, filtersFor(m), { keepFolders: true });
  }, [filtersFor, pendingIn]);
  const rawDir = listing.data?.pages[0]?.entry;
  const hasIgnored = listing.data?.pages.some(p => (p.ignored ?? 0) > 0) ?? false;
  const dir = useMemo(() => {
    if (rawDir)
      return maskEntry(rawDir, features);
    // Inside a pending folder: act as the folder exists, with the mount's caps.
    return pendingHere && mount
      ? maskEntry({
          ...pendingIn(mount, dirname(path)).find(e => e.path === path)!,
          path,
        }, features)
      : undefined;
  }, [
    rawDir,
    features,
    pendingHere,
    mount,
    path,
    pendingIn,
  ]);
  const order = useMemo(() => entries.map(e => e.path), [entries]);
  const byPath = useMemo(() => new Map(entries.map(e => [e.path, e])), [entries]);
  const { pick } = props;
  const pickable = (e: FmEntry) => e.kind === "file" && acceptsEntry(e, pick?.accept);
  const selection = useMemo(() => {
    const sel = prune(rawSelection, order);
    if (!pick)
      return sel;
    // Only accepted files can be picked; single mode keeps the latest one.
    const paths = [...sel.paths].filter((p) => {
      const e = byPath.get(p);
      return !!e && e.kind === "file" && acceptsEntry(e, pick.accept);
    });
    return {
      paths: new Set(pick.multiple
        ? paths
        : paths.slice(-1)),
      anchor: sel.anchor,
    };
  }, [rawSelection, order, pick, byPath]);
  const selected = useMemo(() => [...selection.paths].map(p => byPath.get(p)).filter((e): e is FmEntry => !!e), [selection, byPath]);
  // With the tree shown, the right side shows the open file instead of listing the folder.
  // Selecting a file opens it; folders, mounts and an empty selection leave it open.
  const explorer = split && !pick;
  const [openFile, setOpenFile] = useState<FmEntry>();
  const picked = explorer && !inTrash && selected.length === 1 && selected[0]!.kind === "file"
    ? selected[0]
    : undefined;
  if (picked && (picked.mount !== openFile?.mount || picked.path !== openFile.path || picked.etag !== openFile.etag))
    setOpenFile(picked);
  // Gone from its own, fully loaded folder: deleted or renamed elsewhere.
  if (openFile && !picked && openFile.mount === mount && dirname(openFile.path) === path && !inTrash
    && listing.isSuccess && !listing.isPlaceholderData && !listing.hasNextPage && !query.trim() && !hasFilters(filters) && !byPath.has(openFile.path)) {
    setOpenFile(undefined);
  }
  const paneFile = explorer && !inTrash
    ? openFile
    : undefined;
  useEffect(() => {
    paneDirtyRef.current = false;
  }, [paneFile?.path]);

  // Host metadata: starred / recent lists, and opened files reported as recent.
  // Host switches (`features`) decide what exists; the explorer menu lets users hide the sections.
  const meta = useMemo(() => props.meta && {
    ...props.meta,
    ...(features.starred
      ? {}
      : { starred: undefined, setStarred: undefined }),
    ...(features.recent
      ? {}
      : { recent: undefined, touch: undefined }),
  }, [props.meta, features.starred, features.recent]);
  const [showStarred, setShowStarred] = useStoredChoice(`${storageKey}:show-starred`, ["on", "off"], "on");
  const [showRecent, setShowRecent] = useStoredChoice(`${storageKey}:show-recent`, ["on", "off"], "on");
  const starred = useMetaEntries(client, meta, "starred");
  const recent = useMetaEntries(client, meta, "recent");
  const isStarred = (e: FmEntry) => !!starred.data?.some(s => s.mount === e.mount && s.path === e.path);
  const toggleStar = (e: FmEntry) => {
    void meta?.setStarred?.({ mount: e.mount, path: e.path }, !isStarred(e)).then(
      () => qc.invalidateQueries({
        queryKey: metaKey(client, "starred"),
      }),
      (err: unknown) => setError(err instanceof Error
        ? err.message
        : String(err)),
    );
  };
  const openedFile = paneFile ?? preview;
  const touchRef = useRef(meta?.touch);
  touchRef.current = meta?.touch;
  const openedMount = openedFile?.mount;
  const openedPath = openedFile?.path;
  useEffect(() => {
    if (!openedMount || !openedPath || !touchRef.current)
      return;
    touchRef.current({ mount: openedMount, path: openedPath });
    void qc.invalidateQueries({
      queryKey: metaKey(client, "recent"),
    });
  }, [openedMount, openedPath, qc, client]);
  // Review: changes of every shown mount that has them, decorations and the Changes section.
  const reviewer = useMemo(() => (props.plugins ?? []).find(p => p.review)?.review, [props.plugins]);
  const changeMounts = useMemo(() => (shownMounts ?? []).filter(m => m.changes).map(m => m.id), [shownMounts]);
  const changeQueries = useQueries({
    queries: changeMounts.map(id => changesQuery(client, id)),
  });
  const changesKey = changeQueries.map(q => q.dataUpdatedAt).join();
  const changeIndex = useMemo(
    () => new Map(changeMounts.map((id, i) => [
      id,
      indexChanges(changeQueries[i]?.data),
    ])),
    // eslint-disable-next-line react/exhaustive-deps -- `changesKey` stands for the query results.
    [changeMounts, changesKey],
  );
  const changesOf = useCallback((m: string) => changeIndex.get(m), [changeIndex]);
  const [review, setReview] = useState<{ mount: string; path?: string | undefined }>();
  // Set below, once `reveal` exists.
  const openChangeRef = useRef<(e: FmEntry) => void>(() => {});
  const changeEntries = useMemo(() => changeMounts.flatMap((id, i) => (changeQueries[i]?.data ?? []).map((c): FmEntry => ({
    mount: id,
    path: c.path,
    name: basename(c.path),
    kind: "file",
    size: 0,
    mtime: "",
    etag: "",
    caps: {
      read: true,
      write: false,
      delete: false,
      rename: false,
      move: false,
      copy: false,
    },
  // eslint-disable-next-line react/exhaustive-deps -- `changesKey` stands for the query results.
  }))), [changeMounts, changesKey]);

  // Line counts over every change that has them.
  const changeTotals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let counted = false;
    for (const q of changeQueries) {
      for (const c of q.data ?? []) {
        if (c.additions === undefined)
          continue;
        counted = true;
        additions += c.additions;
        deletions += c.deletions ?? 0;
      }
    }
    return counted
      ? { additions, deletions }
      : undefined;
  // eslint-disable-next-line react/exhaustive-deps -- `changesKey` stands for the query results.
  }, [changesKey]);

  const treeSections = useMemo(() => [
    ...(changeEntries.length
      ? [
          {
            id: "changes",
            label: labels.changes,
            icon: <GitCompareIcon className="text-muted-foreground" />,
            entries: changeEntries,
            extra: changeTotals && (
              <span className="shrink-0 text-xs tabular-nums" data-fm-change-totals="">
                <span className="text-emerald-600 dark:text-emerald-400">{`+${changeTotals.additions}`}</span>
                {" "}
                <span className="text-red-600 dark:text-red-400">{`−${changeTotals.deletions}`}</span>
              </span>
            ),
            onOpen: (e: FmEntry) => openChangeRef.current(e),
          },
        ]
      : []),
    ...(meta?.starred && showStarred === "on"
      ? [
          {
            id: "starred",
            label: labels.starred,
            icon: <StarIcon className="text-amber-500" />,
            entries: starred.data ?? [],
          },
        ]
      : []),
    ...(meta?.recent && showRecent === "on"
      ? [
          {
            id: "recent",
            label: labels.recent,
            icon: <HistoryIcon className="text-muted-foreground" />,
            entries: recent.data ?? [],
          },
        ]
      : []),
  ], [
    changeEntries,
    changeTotals,
    meta,
    showStarred,
    showRecent,
    labels,
    starred.data,
    recent.data,
  ]);
  const mutations = useFmMutations(client, mount ?? "");
  const canWrite = !!dir?.caps.write;
  const canUpload = canWrite && features.upload;
  const canMkdir = canWrite && features.createFolder;
  const canNewFile = canWrite && features.createFile;

  /** Refreshes the listings of a mount other than the current one too. */
  const refreshMount = (m: string) => m === mount
    ? mutations.invalidate()
    : qc.invalidateQueries({
        queryKey: fmKeys.lists(client, m),
      });
  const mountWritable = (m: string) => !!mounts.data?.find(x => x.id === m)?.caps.write;

  const onUploadedRef = useRef((_task: FmUploadTask) => {});
  onUploadedRef.current = task => void refreshMount(task.mount);
  const mountsRef = useRef(mounts.data);
  mountsRef.current = mounts.data;
  const [queue] = useState(() => createUploadQueue({
    transport: xhrTransport(client),
    client,
    // Mounts with `uploads: false` take every file in one request.
    sessions: m => mountsRef.current?.find(x => x.id === m)?.uploadSessions !== false,
    onUploaded: task => onUploadedRef.current(task),
  }));

  const shownError = error ?? (pendingHere ? undefined : listing.error?.message) ?? (below
    ? search.error?.message
    : undefined);
  const currentMount = mounts.data?.find(m => m.id === mount);
  const trashItems = useTrash(client, mount, inTrash).data ?? [];

  useEffect(() => {
    if (!notice)
      return;
    const timer = setTimeout(setNotice, 8000, undefined);
    return () => clearTimeout(timer);
  }, [notice]);

  const go = useCallback((m: string, p: string, trash: boolean) => {
    setLocation({ mount: m, path: p, trash });
    setRawSelection(EMPTY_SELECTION);
    setQuery("");
    setSearchScope("folder");
    setError(undefined);
  }, []);
  const navigate = useCallback((m: string, p: string) => go(m, p, false), [go]);

  const changeQuery = (q: string) => {
    setQuery(q);
    if (!q.trim())
      setSearchScope("folder");
  };

  const failedMessage = (results: { ok: boolean; error?: { message: string } | undefined }[]) => {
    const failed = results.filter(r => !r.ok);
    return failed.length
      ? `${labels.failed(failed.length)}: ${failed[0]!.error?.message ?? ""}`
      : undefined;
  };

  const runUndo = async (m: string, undo: FmUndo) => {
    const message = await ask();
    if (message === null)
      return;
    setNotice(undefined);
    try {
      const results = "restore" in undo
        ? (await client.restore(m, undo.restore, { message })).results
        : [];
      if ("ops" in undo) {
        for (const req of undo.ops)
          results.push(...(await client.ops(m, req, { message })).results);
      }
      setError(failedMessage(results));
      used();
    }
    catch (e) {
      setError(e instanceof Error
        ? e.message
        : String(e));
    }
    await qc.invalidateQueries({
      queryKey: fmKeys.all(client),
    });
  };

  const doneMessage = (req: FmOpsRequest, n: number) => {
    switch (req.op) {
      case "delete": return labels.movedToTrash(n);
      case "rename": return labels.renamed;
      case "move": return labels.movedItems(n);
      default: return labels.copiedItems(n);
    }
  };

  /** `from`: source mount when it is not the current one. */
  const runOps = async (req: FmOpsRequest, after?: () => void, from?: string) => {
    const m = from ?? mount;
    if (!m)
      return;
    const message = await ask();
    if (message === null)
      return;
    // No undo across mounts: it would have to run on both.
    const crossMount = (!!from && from !== mount) || ("destMount" in req && !!req.destMount && req.destMount !== m);
    mutations.ops.mutate({ mount: m, req, message }, {
      onSuccess: (res) => {
        used();
        if (m && req.op !== "copy") {
          for (const r of res.results) {
            if (r.ok)
              clearDrafts(m, r.path);
          }
          dropPendingFolders(m, res.results.filter(r => r.ok).map(r => r.path));
        }
        setError(failedMessage(res.results));
        const undo = m && !crossMount && undoFor(req, res.results);
        setNotice(undo
          ? {
              message: doneMessage(req, res.results.filter(r => r.ok).length),
              undo: () => void runUndo(m, undo),
            }
          : undefined);
        after?.();
      },
      onError: e => setError(e.message),
    });
  };

  /** Mounts with a trash delete right away (undo is offered); others confirm first. */
  const requestDelete = (paths: string[], from = mount, after?: () => void) => {
    if (!from)
      return;
    const done = () => {
      setRawSelection(EMPTY_SELECTION);
      after?.();
    };
    if (mounts.data?.find(m => m.id === from)?.trash) {
      runOps({ op: "delete", paths }, done, from);
    }
    else {
      setDialog({
        kind: "delete",
        paths,
        mount: from,
        after: done,
      });
    }
  };

  /** Search hit: go to its folder with the hit selected. */
  const reveal = (e: FmEntry) => guard(() => {
    setReview(undefined);
    navigate(e.mount, dirname(e.path));
    setRawSelection({
      paths: new Set([e.path]),
      anchor: e.path,
    });
  });

  /** A changed file: its diff with a review plugin, else the file itself. */
  const openChange = (e: FmEntry) => {
    if (!reviewer)
      return reveal(e);
    setReview({ mount: e.mount, path: e.path });
    setNarrowPane("main");
  };
  openChangeRef.current = openChange;

  const open = (e: FmEntry) => {
    if (e.kind === "dir")
      navigate(e.mount, e.path);
    else if (explorer)
      reveal(e);
    else if (!pick)
      setPreview(e);
    else if (pickable(e) && pick.multiple)
      setRawSelection(s => select(s, e.path, "toggle", order));
    else if (pickable(e))
      pick.onPick([e]);
  };
  const openEntry = below
    ? reveal
    : open;

  /** Quick-open pick: a folder opens, a file previews within its folder. */
  const pickQuickOpen = (e: FmEntry) => {
    if (e.kind === "dir")
      return navigate(e.mount, e.path);
    if (explorer) {
      setNarrowPane("main");
      return reveal(maskEntry(e, features));
    }
    navigate(e.mount, dirname(e.path));
    setPreview(maskEntry(e, features));
  };
  const canQuickOpen = features.search && !inTrash && !!mount;

  // Restores the last location once the mounts are known; stale parts fall back silently.
  const lastKey = `${storageKey}:last`;
  const restoreRef = useRef(props.initialMount === undefined && props.initialPath === undefined && typeof localStorage !== "undefined");
  const [restored, setRestored] = useState(!restoreRef.current);
  useEffect(() => {
    if (!restoreRef.current || !mounts.data)
      return;
    restoreRef.current = false;
    const last = readLast(lastKey);
    const m = last && visibleMounts(mounts.data, props.sidebar?.hidden ?? [], userHidden, undefined).find(x => x.id === last.mount);
    if (!last || !m) {
      setRestored(true);
      return;
    }
    const stat = (p: string) => client.stat(m.id, p).catch(() => undefined);
    void (async () => {
      const dir = last.path === "/"
        ? undefined
        : await stat(last.path);
      const folder = dir?.kind === "dir"
        ? dir.path
        : "/";
      // The file reopens only in the tree layout, where it shows inline; the list layout never pops a dialog.
      const file = explorer && last.file && dirname(last.file) === folder
        ? await stat(last.file)
        : undefined;
      navigate(m.id, folder);
      if (file?.kind === "file") {
        setRawSelection({
          paths: new Set([file.path]),
          anchor: file.path,
        });
      }
      setRestored(true);
    })();
  }, [
    mounts.data,
    lastKey,
    props.sidebar?.hidden,
    userHidden,
    client,
    navigate,
    explorer,
  ]);
  const shownFile = inTrash
    ? undefined
    : explorer
      ? paneFile
      : preview;
  useEffect(() => {
    if (restored && mount)
      localStorage.setItem(lastKey, JSON.stringify({ mount, path, file: shownFile?.path }));
  }, [
    restored,
    lastKey,
    mount,
    path,
    shownFile?.path,
  ]);

  const download = (targets: FmEntry[]) => {
    if (targets.length === 0)
      return;
    const only = targets[0]!;
    triggerDownload(targets.length === 1 && only.kind === "file"
      ? client.readUrl(only.mount, only.path, { download: true })
      : client.archiveUrl(only.mount, targets.map(t => t.path)));
  };

  const copyToClipboard = (mode: FmClipboard["mode"], targets: FmEntry[]) => {
    if (targets.length) {
      setClipboard({
        mode,
        mount: targets[0]!.mount,
        paths: targets.map(t => t.path),
      });
    }
  };

  const canPaste = !!clipboard && !!mount && canWrite;
  const pasteInto = (to: FolderRef) => {
    if (!clipboard)
      return;
    runOps({
      op: clipboard.mode === "cut"
        ? "move"
        : "copy",
      paths: clipboard.paths,
      dest: to.path,
      ...(clipboard.mount !== to.mount
        ? { destMount: to.mount }
        : {}),
      conflict: "rename",
    }, () => {
      if (clipboard.mode === "cut")
        setClipboard(undefined);
    }, clipboard.mount);
  };
  const paste = () => {
    if (canPaste && mount)
      pasteInto({ mount, path });
  };

  /** Tree drop: move within the mount, copy to another one. */
  const dropEntries = (paths: string[], to: string, folder: string, from?: string) => {
    const source = from ?? mount;
    if (!source)
      return;
    const cross = to !== source;
    if ((cross && !features.copy) || (!cross && !features.move))
      return;
    runOps({
      op: cross
        ? "copy"
        : "move",
      paths,
      dest: folder,
      ...(cross
        ? { destMount: to }
        : {}),
      conflict: "rename",
    }, undefined, source);
  };

  const copyContents = async (entry: FmEntry) => {
    if (!mount)
      return;
    try {
      const { text } = await client.readText(mount, entry.path);
      await navigator.clipboard.writeText(text);
      setNotice({ message: labels.contentsCopied });
    }
    catch (e) {
      setError(e instanceof Error
        ? e.message
        : String(e));
    }
  };

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ message });
    }
    catch (e) {
      setError(e instanceof Error
        ? e.message
        : String(e));
    }
  };

  /** `to`: target folder when it is not the current one. */
  const upload = async (files: FmUploadFile[], to?: FolderRef) => {
    const m = to?.mount ?? mount;
    const folder = to?.path ?? path;
    if (!m || files.length === 0)
      return;
    const message = await ask();
    if (message === null)
      return;
    if (message)
      files = files.map(f => ({ ...f, message }));
    const names = [
      ...new Set(files.map(topName)),
    ];
    // Trust the loaded listing only when it is current, unfiltered and complete; otherwise ask the server.
    const complete = !to && listing.isSuccess && !listing.isFetching && !query.trim() && !listing.hasNextPage;
    const existing = complete
      ? new Set(entries.map(e => e.name))
      : new Set(await Promise.all(names.map(n => client.stat(m, joinPath(folder, n)).then(() => n, () => ""))));
    const clashes = new Set(files.filter(f => !(f.relativePath ?? "").includes("/")).map(topName).filter(n => existing.has(n)));
    if (clashes.size) {
      setDialog({
        kind: "uploadConflict",
        files,
        clashes,
        to: { mount: m, path: folder },
      });
    }
    else {
      queue.getState().enqueue(m, folder, files);
    }
  };

  const pickFiles = (input: HTMLInputElement | null, to?: FolderRef) => {
    uploadToRef.current = to;
    input?.click();
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    void upload(filesFromInput(e.target.files!), uploadToRef.current);
    uploadToRef.current = undefined;
    e.target.value = "";
  };

  const onSelect = (p: string, mode: FmSelectMode) => setRawSelection(s => select(s, p, pick
    ? (pick.multiple
        ? (mode === "single"
            ? "toggle"
            : mode)
        : "single")
    : mode, order));

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    // Before the input check so it also works from the search box.
    if (mod && e.key.toLowerCase() === "p" && canQuickOpen && !dialog && !preview && !quickOpen) {
      e.preventDefault();
      setQuickOpen(true);
      return;
    }
    if (inTrash || dialog || preview || (e.target as HTMLElement).closest("input, textarea, [contenteditable]"))
      return;
    const one = selected.length === 1
      ? selected[0]
      : undefined;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        guard(() => setRawSelection(s => step(prune(s, order), order, 1, e.shiftKey)));
        break;
      case "ArrowUp":
      case "ArrowLeft":
        guard(() => setRawSelection(s => step(prune(s, order), order, -1, e.shiftKey)));
        break;
      case "Enter":
        if (pick && selection.anchor !== undefined && byPath.has(selection.anchor))
          open(byPath.get(selection.anchor)!);
        else if (one)
          openEntry(one);
        break;
      case "Backspace":
        if (mount && path !== "/")
          navigate(mount, dirname(path));
        break;
      case "Delete":
        if (selected.length && selected.every(x => x.caps.delete))
          requestDelete(selected.map(x => x.path));
        break;
      case "F2":
        if (one?.caps.rename)
          setDialog({ kind: "rename", entry: one });
        break;
      case "Escape":
        setRawSelection(EMPTY_SELECTION);
        break;
      case "a":
        if (!mod)
          return;
        setRawSelection({
          paths: new Set(order),
          anchor: order[0],
        });
        break;
      case "c":
        if (!mod)
          return;
        if (selected.every(x => x.caps.copy))
          copyToClipboard("copy", selected);
        break;
      case "x":
        if (!mod)
          return;
        if (selected.every(x => x.caps.move))
          copyToClipboard("cut", selected);
        break;
      case "v":
        // Without entries cut / copied here, let the browser fire `paste` (OS files upload).
        if (!mod || !clipboard)
          return;
        paste();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // Files on the OS clipboard (screenshots, files copied in a file browser) upload into the current folder.
  const onPasteFiles = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = e.clipboardData.files;
    if (!canUpload || files.length === 0 || (e.target as HTMLElement).closest("input, textarea, [contenteditable=true]"))
      return;
    e.preventDefault();
    void upload(filesFromInput(files));
  };

  // OS files (and folders) dropped anywhere on the right side upload into the current folder.
  // Drags of entries inside the manager carry no files and are left to the list / tree.
  const dropzone = useDropzone({
    noClick: true,
    noKeyboard: true,
    noPaste: true,
    disabled: !canUpload,
    onDrop: files => void upload(filesFromDropzone(files)),
  });

  const menuItem = (key: string, label: string, icon: ReactNode, fn: () => void, opts: { show?: boolean; destructive?: boolean; shortcut?: string } = {}) =>
    opts.show === false
      ? null
      : (
          <ContextMenuItem key={key} variant={opts.destructive ? "destructive" : "default"} onClick={fn}>
            {icon}
            {label}
            {opts.shortcut && <ContextMenuShortcut aria-hidden>{opts.shortcut}</ContextMenuShortcut>}
          </ContextMenuItem>
        );
  /** Shared shell for the list and tree context menus. */
  const menuContent = (items: FmMenuItems | false | undefined) => <ContextMenuContent className="w-56">{tidyMenu(items || [])}</ContextMenuContent>;

  const runAction = (action: FmFileAction, targets: FmEntry[], at?: FolderRef) => {
    const m = at?.mount ?? mount;
    if (!m)
      return;
    const ctx: FmActionContext = {
      client,
      mount: m,
      path: at?.path ?? path,
      refresh: async () => {
        await qc.invalidateQueries({
          queryKey: fmKeys.all(client),
        });
      },
      preview: setPreview,
      fail: setError,
    };
    void Promise.resolve(action.run(targets, ctx)).catch((e: unknown) => setError(e instanceof Error
      ? e.message
      : String(e)));
  };

  /** New file / folder and upload into `to` without navigating there. */
  const hereMenu = (to: FolderRef, writable: boolean) => [
    menuItem("newFileHere", labels.newFileHere, <FilePlusIcon />, () => setDialog({ kind: "newFile", to }), { show: writable && features.createFile }),
    menuItem("newFolderHere", labels.newFolderHere, <FolderPlusIcon />, () => setDialog({ kind: "mkdir", to }), { show: writable && features.createFolder }),
    menuItem("uploadHere", labels.uploadHere, <UploadIcon />, () => pickFiles(fileInputRef.current, to), { show: writable && features.upload }),
  ];

  /** `from`: folder holding the targets when it is not the current one (tree folder rows). */
  const entryMenu = (targets: FmEntry[], from?: FolderRef) => {
    const one = targets.length === 1
      ? targets[0]
      : undefined;
    const custom = [
      ...(props.actions ?? []),
      ...(props.plugins ?? []).flatMap(p => p.actions ?? []),
    ]
      .filter(a => !a.when || a.when(targets));
    return [
      one && menuItem("open", labels.open, one.kind === "dir"
        ? <FolderOpenIcon />
        : <EyeIcon />, () => open(one), { shortcut: KEYS.open }),
      one && menuItem("openChanges", labels.openChanges, <GitCompareIcon />, () => openChange(one), {
        show: !!reviewer && !!changeIndex.get(one.mount)?.byPath.has(one.path),
      }),
      menuItem("download", labels.download, <DownloadIcon />, () => download(targets), { show: features.download }),
      one && menuItem("star", isStarred(one)
        ? labels.removeStar
        : labels.addStar, <StarIcon />, () => toggleStar(one), { show: !!meta?.setStarred && !inTrash }),
      one?.kind === "dir" && !inTrash && hereMenu({ mount: one.mount, path: one.path }, one.caps.write),
      <ContextMenuSeparator key="s1" />,
      menuItem("cut", labels.cut, <ScissorsIcon />, () => copyToClipboard("cut", targets), {
        show: targets.every(t => t.caps.move),
        shortcut: KEYS.cut,
      }),
      menuItem("copy", labels.copy, <CopyIcon />, () => copyToClipboard("copy", targets), {
        show: targets.every(t => t.caps.copy),
        shortcut: KEYS.copy,
      }),
      menuItem("duplicate", labels.duplicate, <CopyPlusIcon />, () => runOps({
        op: "copy",
        paths: targets.map(t => t.path),
        dest: from?.path ?? path,
        conflict: "rename",
      }, undefined, from?.mount), {
        show: (from
          ? mountWritable(from.mount)
          : canWrite) && targets.every(t => t.caps.copy),
      }),
      one && menuItem("copyContents", labels.copyContents, <ClipboardCopyIcon />, () => void copyContents(one), {
        show: features.download && !inTrash && one.kind === "file" && kindOf(one) === "text" && one.size <= 1024 * 1024,
      }),
      one && menuItem("copyPath", labels.copyPath, <ClipboardCopyIcon />, () => void copyText(one.path, labels.pathCopied), { show: !inTrash }),
      one && menuItem("copyName", labels.copyName, <ClipboardCopyIcon />, () => void copyText(one.name, labels.nameCopied), { show: !inTrash }),
      <ContextMenuSeparator key="s2" />,
      one && menuItem("rename", labels.rename, <PencilIcon />, () => setDialog({ kind: "rename", entry: one }), {
        show: one.caps.rename,
        shortcut: KEYS.rename,
      }),
      one && menuItem("details", labels.details, <InfoIcon />, () => {
        // Details show the selection, so select the entry in its folder first.
        if (from)
          reveal(one);
        setDetailsOpen(true);
      }, { show: features.details }),
      custom.length > 0 && <ContextMenuSeparator key="s3" />,
      ...custom.map(a => menuItem(`x-${a.id}`, a.label, a.icon, () => runAction(a, targets, from))),
      <ContextMenuSeparator key="s4" />,
      menuItem("delete", labels.delete, <Trash2Icon />, () => requestDelete(targets.map(t => t.path), from?.mount), {
        show: targets.every(t => t.caps.delete),
        destructive: true,
        shortcut: KEYS.delete,
      }),
    ];
  };

  const blankMenu = () => [
    menuItem("mkdir", labels.newFolder, <FolderPlusIcon />, () => setDialog({ kind: "mkdir" }), { show: canMkdir }),
    menuItem("newFile", labels.newFile, <FilePlusIcon />, () => setDialog({ kind: "newFile" }), { show: canNewFile }),
    menuItem("upload", labels.upload, <UploadIcon />, () => pickFiles(fileInputRef.current), { show: canUpload }),
    menuItem("paste", labels.paste, <ClipboardPasteIcon />, paste, { show: canPaste, shortcut: KEYS.paste }),
    menuItem("refresh", labels.refresh, <RefreshCwIcon />, () => void listing.refetch()),
  ];

  /** Tree mount row: acts on the mount root without opening it. */
  const mountMenu = (m: string) => {
    const root = { mount: m, path: "/" };
    return [
      ...hereMenu(root, mountWritable(m)),
      menuItem("paste", labels.paste, <ClipboardPasteIcon />, () => pasteInto(root), { show: !!clipboard && mountWritable(m) }),
      menuItem("refresh", labels.refresh, <RefreshCwIcon />, () => void refreshMount(m)),
    ];
  };

  const uploadMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IconButton label={labels.upload} />}><UploadIcon /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => pickFiles(fileInputRef.current)}>
          <UploadIcon />
          {labels.upload}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => pickFiles(folderInputRef.current)}>
          <FolderUpIcon />
          {labels.uploadFolder}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  // State, not a ref: the viewport is attached after FileTree's first layout effect (it is an
  // ancestor), so the tree must re-render to pick it up even when no data change follows.
  const [treeViewport, setTreeViewport] = useState<HTMLDivElement | null>(null);
  const treeViewportRef = useMemo(() => viewportRef<HTMLDivElement>(setTreeViewport), []);
  // Explorer refresh also reveals the selected row (or the current folder) like VS Code:
  // its ancestors open and the tree scrolls the row into view once it is loaded.
  const [revealTick, setRevealTick] = useState(0);
  const refreshTree = () => {
    void qc.invalidateQueries({
      queryKey: fmKeys.all(client),
    });
    if (!mount)
      return;
    const target = selected.length === 1
      ? selected[0]!.path
      : path;
    setExpanded(s => new Set([
      ...s,
      ...onPathKeys(mount, target, inTrash),
    ]));
    setRevealTick(t => t + 1);
  };
  const refreshButton = (
    <IconButton
      label={labels.refresh}
      onClick={() => void qc.invalidateQueries({
        queryKey: fmKeys.all(client),
      })}
    >
      <RefreshCwIcon />
    </IconButton>
  );

  const crumbs = path === "/"
    ? []
    : path.slice(1).split("/");

  const detailsEntry = detailsOpen && features.details && !inTrash
    ? (selected.length === 1
        ? selected[0]
        : dir)
    : undefined;
  const sideDetails = !!detailsEntry && !narrow;
  const panes = useDefaultLayout({
    id: `${storageKey}:panels`,
    panelIds: [
      ...(split && !stacked
        ? ["tree"]
        : []),
      "main",
      ...(sideDetails
        ? ["details"]
        : []),
    ],
    ...(typeof localStorage !== "undefined"
      ? { storage: localStorage }
      : {}),
  });

  // Tree toolbar and folder tree; a side panel, or a full-size view on narrow containers.
  const treePane = (
    <>
      {explorer && (
        // VS Code style: title on the left, common actions, the rest under "More". With a mouse the
        // actions appear on hover and take no room otherwise, so the title is not cut short; touch
        // screens, which cannot hover, always show them.
        <div className="group/explorer flex h-9 shrink-0 items-center gap-0.5 pr-1 pl-3">
          <span className="flex-1 truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{labels.explorer}</span>
          <div
            role="toolbar"
            aria-label={labels.folderActions}
            className="flex items-center gap-0.5 pointer-fine:w-0 pointer-fine:overflow-hidden pointer-fine:opacity-0 group-hover/explorer:w-auto group-hover/explorer:overflow-visible group-hover/explorer:opacity-100 focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100 has-aria-expanded:w-auto has-aria-expanded:overflow-visible has-aria-expanded:opacity-100"
          >
            {canNewFile && <IconButton label={labels.newFile} onClick={() => setDialog({ kind: "newFile" })}><FilePlusIcon /></IconButton>}
            {canMkdir && <IconButton label={labels.newFolder} onClick={() => setDialog({ kind: "mkdir" })}><FolderPlusIcon /></IconButton>}
            <IconButton label={labels.refresh} onClick={refreshTree}><RefreshCwIcon /></IconButton>
            <IconButton label={labels.collapseAll} onClick={collapseAll}><ChevronsDownUpIcon /></IconButton>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<IconButton label={labels.more} />}><EllipsisIcon /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canUpload && (
                <>
                  <DropdownMenuItem onClick={() => pickFiles(fileInputRef.current)}>
                    <UploadIcon />
                    {labels.upload}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => pickFiles(folderInputRef.current)}>
                    <FolderUpIcon />
                    {labels.uploadFolder}
                  </DropdownMenuItem>
                </>
              )}
              {canPaste && (
                <DropdownMenuItem onClick={paste}>
                  <ClipboardPasteIcon />
                  {labels.paste}
                </DropdownMenuItem>
              )}
              {canQuickOpen && (
                <DropdownMenuItem onClick={() => setQuickOpen(true)}>
                  <FileSearchIcon />
                  {labels.quickOpen}
                </DropdownMenuItem>
              )}
              {(canUpload || canPaste || canQuickOpen) && <DropdownMenuSeparator />}
              {reviewer && changeEntries.length > 0 && mount && (
                <DropdownMenuItem onClick={() => setReview({
                  mount: changeIndex.get(mount)?.byPath.size
                    ? mount
                    : changeEntries[0]!.mount,
                })}
                >
                  <GitCompareIcon />
                  {labels.reviewAll}
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FilterIcon />
                  {labels.filter}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <FilterMenuItems filters={filters} onChange={changeFilters} labels={labels} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuCheckboxItem closeOnClick checked={showHidden} onCheckedChange={on => setHiddenFiles(on ? "on" : "off")}>
                {labels.showHiddenFiles}
              </DropdownMenuCheckboxItem>
              {meta?.starred && (
                <DropdownMenuCheckboxItem closeOnClick checked={showStarred === "on"} onCheckedChange={on => setShowStarred(on ? "on" : "off")}>
                  {labels.showStarred}
                </DropdownMenuCheckboxItem>
              )}
              {meta?.recent && (
                <DropdownMenuCheckboxItem closeOnClick checked={showRecent === "on"} onCheckedChange={on => setShowRecent(on ? "on" : "off")}>
                  {labels.showRecent}
                </DropdownMenuCheckboxItem>
              )}
              {(hasIgnored || !showIgnored) && (
                <DropdownMenuCheckboxItem closeOnClick checked={showIgnored} onCheckedChange={on => setIgnoredFiles(on ? "on" : "off")}>
                  {labels.showIgnoredFiles}
                </DropdownMenuCheckboxItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {explorer && <FilterChips filters={filters} onChange={changeFilters} labels={labels} />}
      <ScrollArea
        className="min-h-0 flex-1"
        // The virtualized tree scrolls the viewport, not the root.
        ref={treeViewportRef}
      >
        {shownMounts && (
          <ContextMenu>
            <ContextMenuTrigger
              render={<div className="min-h-full" />}
              onContextMenu={(e) => {
                if (!treeTargetRef.current)
                  e.preventBaseUIHandler();
                treeTargetRef.current = undefined;
              }}
            >
              <FileTree
                client={client}
                mounts={features.trash
                  ? shownMounts
                  : shownMounts.map(m => ({ ...m, trash: false }))}
                mount={mount}
                path={path}
                inTrash={inTrash}
                expanded={expanded}
                onExpandedChange={setRowExpanded}
                onNavigate={navigate}
                onOpenTrash={(m) => {
                  go(m, "/", true);
                  setNarrowPane("main");
                }}
                onRevealFile={(e) => {
                  reveal(e);
                  setNarrowPane("main");
                }}
                selected={selected.length === 1
                  ? selected[0]!.path
                  : undefined}
                onDropEntries={dropEntries}
                filter={filter}
                readOnlyLabel={labels.readOnly}
                trashLabel={labels.trash}
                group={props.sidebar?.group}
                drives={props.sidebar?.drives}
                groupLabel={labels.driverGroup}
                manageLabel={labels.manageDrives}
                onManage={canManageDrives
                  ? () => setDialog({ kind: "manageDrives" })
                  : undefined}
                scrollElement={treeViewport}
                revealTick={revealTick}
                filterEntries={treeFilter}
                changesOf={changesOf}
                sections={treeSections}
                onContextTarget={(target) => {
                  treeTargetRef.current = target;
                  setTreeTarget(target);
                  // File menus act on the current folder (copy contents), so show the file first;
                  // folder and mount menus target their row directly.
                  if (target?.entry?.kind === "file")
                    reveal(target.entry);
                }}
              />
            </ContextMenuTrigger>
            {menuContent(treeTarget && (treeTarget.entry
              ? entryMenu([treeTarget.entry], treeTarget.entry.kind === "dir"
                  ? {
                      mount: treeTarget.entry.mount,
                      path: dirname(treeTarget.entry.path),
                    }
                  : undefined)
              : mountMenu(treeTarget.mount)))}
          </ContextMenu>
        )}
      </ScrollArea>
    </>
  );

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
        <ResizablePanelGroup id={`${storageKey}:panels`} orientation="horizontal" className="min-w-0 flex-1" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
          {split && !stacked && (
            <ResizablePanel id="tree" defaultSize="224px" minSize="160px" maxSize="40%" className="flex flex-col">
              {treePane}
            </ResizablePanel>
          )}
          {split && !stacked && <ResizableHandle withHandle aria-label={labels.resizeTree} />}

          <ResizablePanel id="main" minSize="320px">

            <section
              {...dropzone.getRootProps({
                "className": "relative flex h-full min-w-0 flex-col outline-none",
                "tabIndex": 0,
                "inert": treeOnly,
                "role": "region",
                "aria-label": currentMount?.label,
                // Read-only only turns off dropping, not the whole section.
                "aria-disabled": undefined,
              })}
              // Outside getRootProps: with noKeyboard it drops onKeyDown.
              onKeyDown={onKeyDown}
            >
              <header className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
                {stacked && (
                  <IconButton label={labels.backToTree} onClick={() => guard(() => setNarrowPane("tree"))}>
                    <ArrowLeftIcon />
                  </IconButton>
                )}
                {explorer && !inTrash && mount && shownMounts
                  ? (
                      <PathBar
                        client={client}
                        mounts={shownMounts}
                        mount={mount}
                        path={path}
                        file={paneFile}
                        labels={labels}
                        filter={filter}
                        onOpenFile={reveal}
                      />
                    )
                  : (
                      <>
                        <IconButton label={labels.up} disabled={path === "/"} onClick={() => mount && navigate(mount, dirname(path))}>
                          <ArrowUpIcon />
                        </IconButton>
                        {/* Narrow: the toolbar wraps below the breadcrumb instead of squeezing it. */}
                        <Breadcrumb className={cn("min-w-0 flex-1 px-1", narrow && "basis-[calc(100%-2.5rem)]")}>
                          <BreadcrumbList className="flex-nowrap overflow-hidden">
                            <BreadcrumbItem>
                              {!split && shownMounts
                                ? (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger render={<button type="button" className="flex items-center gap-1 rounded-sm hover:text-foreground" aria-label={labels.storage} />}>
                                        <span className="truncate">{currentMount?.label}</span>
                                        <ChevronDownIcon className="size-3.5" />
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="start" className="w-56">
                                        <DropdownMenuRadioGroup
                                          value={inTrash
                                            ? ""
                                            : mount ?? ""}
                                          onValueChange={v => navigate(v as string, "/")}
                                        >
                                          {props.sidebar?.group === "driver"
                                            ? groupMountsByDriver(shownMounts).map(g => (
                                                <DropdownMenuGroup key={g.driver}>
                                                  <DropdownMenuLabel>{labels.driverGroup(g.driver)}</DropdownMenuLabel>
                                                  {g.mounts.map(m => <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>{m.label}</DropdownMenuRadioItem>)}
                                                </DropdownMenuGroup>
                                              ))
                                            : shownMounts.map(m => <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>{m.label}</DropdownMenuRadioItem>)}
                                        </DropdownMenuRadioGroup>
                                        {treeSections.map(sec => (
                                          <DropdownMenuSub key={sec.id}>
                                            <DropdownMenuSubTrigger>
                                              {sec.icon}
                                              {sec.label}
                                            </DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent className="w-64 overflow-hidden p-0">
                                              <MenuScroll>
                                                {sec.entries.map(e => (
                                                  <DropdownMenuItem key={`${e.mount}:${e.path}`} title={`${e.mount}:${e.path}`} onClick={() => pickQuickOpen(e)}>
                                                    <EntryIcon entry={e} />
                                                    <span className="truncate">{e.name}</span>
                                                  </DropdownMenuItem>
                                                ))}
                                              </MenuScroll>
                                            </DropdownMenuSubContent>
                                          </DropdownMenuSub>
                                        ))}
                                        {treeSections.length > 0 && <DropdownMenuSeparator />}
                                        {currentMount?.trash && features.trash && (
                                          <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => go(currentMount.id, "/", true)}>
                                              <Trash2Icon />
                                              {labels.trash}
                                            </DropdownMenuItem>
                                          </>
                                        )}
                                        {canManageDrives && (
                                          <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => setDialog({ kind: "manageDrives" })}>
                                              <SettingsIcon />
                                              {labels.manageDrives}
                                            </DropdownMenuItem>
                                          </>
                                        )}
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )
                                : crumbs.length || inTrash
                                  ? <BreadcrumbLink render={<button type="button" onClick={() => mount && navigate(mount, "/")} />}>{currentMount?.label}</BreadcrumbLink>
                                  : <BreadcrumbPage>{currentMount?.label}</BreadcrumbPage>}
                            </BreadcrumbItem>
                            {inTrash && (
                              <>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                  <BreadcrumbPage>{labels.trash}</BreadcrumbPage>
                                </BreadcrumbItem>
                              </>
                            )}
                            {!inTrash && crumbs.map((name, i) => {
                              const target = `/${crumbs.slice(0, i + 1).join("/")}`;
                              return [
                                <BreadcrumbSeparator key={`s-${target}`} />,
                                <BreadcrumbItem key={target} className="min-w-0">
                                  {i === crumbs.length - 1
                                    ? <BreadcrumbPage className="truncate">{name}</BreadcrumbPage>
                                    : <BreadcrumbLink className="truncate" render={<button type="button" onClick={() => mount && navigate(mount, target)} />}>{name}</BreadcrumbLink>}
                                </BreadcrumbItem>,
                              ];
                            })}
                          </BreadcrumbList>
                        </Breadcrumb>
                      </>
                    )}

                {inTrash
                  ? (
                      <Button size="sm" variant="ghost" disabled={trashItems.length === 0} onClick={() => setDialog({ kind: "emptyTrash" })}>
                        <Trash2Icon />
                        {labels.emptyTrash}
                      </Button>
                    )
                  : features.search && !explorer && (
                    <div className={cn("relative flex items-center gap-1", narrow && "order-last basis-full")}>
                      <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="search"
                        aria-label={labels.search}
                        placeholder={labels.search}
                        className={cn("h-7 pl-7 text-xs md:text-xs", narrow
                          ? "w-full"
                          : "w-48")}
                        value={query}
                        onChange={e => changeQuery(e.target.value)}
                        onKeyDown={e => e.key === "Escape" && changeQuery("")}
                      />
                      {canQuickOpen && <IconButton label={labels.quickOpen} onClick={() => setQuickOpen(true)}><FileSearchIcon /></IconButton>}
                      {query.trim() && (
                        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={labels.search}>
                          {(["folder", "below"] as const).map(s => (
                            <Button
                              key={s}
                              size="xs"
                              variant={searchScope === s
                                ? "secondary"
                                : "ghost"}
                              aria-pressed={searchScope === s}
                              onClick={() => setSearchScope(s)}
                            >
                              {s === "folder"
                                ? labels.searchHere
                                : labels.searchBelow}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                {inTrash
                  ? null
                  : explorer
                    ? (review || paneFile) && (
                        <div className="flex items-center gap-1" role="toolbar" aria-label={review ? labels.changes : paneFile!.name}>
                          <div ref={setPaneActions} className="flex items-center gap-1" />
                        </div>
                      )
                    : selected.length > 0
                      ? (
                          <div className="flex items-center gap-1" role="toolbar" aria-label={labels.selected(selected.length)}>
                            <span className="px-2 text-xs text-muted-foreground">{labels.selected(selected.length)}</span>
                            {features.download && <IconButton label={labels.download} onClick={() => download(selected)}><DownloadIcon /></IconButton>}
                            {selected.every(s => s.caps.copy) && <IconButton label={labels.copy} onClick={() => copyToClipboard("copy", selected)}><CopyIcon /></IconButton>}
                            {selected.every(s => s.caps.move) && <IconButton label={labels.cut} onClick={() => copyToClipboard("cut", selected)}><ScissorsIcon /></IconButton>}
                            {selected.length === 1 && selected[0]!.caps.rename && <IconButton label={labels.rename} onClick={() => setDialog({ kind: "rename", entry: selected[0]! })}><PencilIcon /></IconButton>}
                            {selected.every(s => s.caps.delete) && (
                              <IconButton
                                label={labels.delete}
                                onClick={() => requestDelete(selected.map(s => s.path))}
                              >
                                <Trash2Icon />
                              </IconButton>
                            )}
                            <IconButton label={labels.cancel} onClick={() => setRawSelection(EMPTY_SELECTION)}><XIcon /></IconButton>
                          </div>
                        )
                      : (
                          <div className="flex items-center gap-1" role="toolbar">
                            {canPaste && (
                              <Button size="sm" variant="ghost" onClick={paste}>
                                <ClipboardPasteIcon />
                                {labels.paste}
                              </Button>
                            )}
                            {canMkdir && <IconButton label={labels.newFolder} onClick={() => setDialog({ kind: "mkdir" })}><FolderPlusIcon /></IconButton>}
                            {canNewFile && <IconButton label={labels.newFile} onClick={() => setDialog({ kind: "newFile" })}><FilePlusIcon /></IconButton>}
                            {canUpload && uploadMenu}
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<IconButton label={labels.filter} aria-pressed={hasFilters(filters)} />}><FilterIcon /></DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <FilterMenuItems filters={filters} onChange={changeFilters} labels={labels} />
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <DropdownMenu>
                              {narrow
                                ? <DropdownMenuTrigger render={<IconButton label={labels.sortBy} />}><ArrowUpDownIcon /></DropdownMenuTrigger>
                                : <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>{labels.sortBy}</DropdownMenuTrigger>}
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuRadioGroup value={sort.key} onValueChange={v => setSort(s => ({ ...s, key: v as FmSortKey }))}>
                                  <DropdownMenuRadioItem value="name">{labels.name}</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="mtime">{labels.modified}</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="size">{labels.size}</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuRadioGroup value={sort.order} onValueChange={v => setSort(s => ({ ...s, order: v as "asc" | "desc" }))}>
                                  <DropdownMenuRadioItem value="asc">{labels.ascending}</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="desc">{labels.descending}</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <IconButton
                              label={view === "list"
                                ? labels.gridView
                                : labels.listView}
                              onClick={() => setView(view === "list"
                                ? "grid"
                                : "list")}
                            >
                              {view === "list"
                                ? <LayoutGridIcon />
                                : <ListIcon />}
                            </IconButton>
                            {refreshButton}
                          </div>
                        )}
                {!narrow && (
                  <IconButton label={split ? labels.hideSidebar : labels.showSidebar} aria-pressed={split} onClick={() => setLayout(split ? "single" : "split")}>
                    <PanelLeftIcon />
                  </IconButton>
                )}
                {!inTrash && features.details && (
                  <IconButton label={labels.details} aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
                    <InfoIcon />
                  </IconButton>
                )}
              </header>

              {!explorer && !inTrash && <FilterChips filters={filters} onChange={changeFilters} labels={labels} />}

              {shownError && (
                <div role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  <span className="flex-1">{shownError}</span>
                  <IconButton size="icon-xs" label={labels.close} onClick={() => setError(undefined)}><XIcon /></IconButton>
                </div>
              )}

              {below && search.data?.truncated && (
                <div className="border-b px-3 py-1 text-xs text-muted-foreground">{labels.searchTruncated}</div>
              )}

              {inTrash && mount
                ? (
                    <TrashView
                      mount={mount}
                      mountLabel={currentMount?.label ?? mount}
                      retentionDays={currentMount?.trashRetentionDays}
                      client={client}
                      labels={labels}
                      onError={setError}
                      onRestored={n => n > 0 && setNotice({ message: labels.restored })}
                    />
                  )
                : explorer
                  ? (review && reviewer
                      ? (
                          <div className="min-h-0 flex-1" data-fm-review="">
                            <ReviewView
                              reviewer={reviewer}
                              client={client}
                              mount={review.mount}
                              labels={labels}
                              changes={changeQueries[changeMounts.indexOf(review.mount)]?.data ?? []}
                              path={review.path}
                              actions={paneActions}
                              onOpenFile={p => reveal({
                                ...changeEntries.find(e => e.mount === review.mount && e.path === p)!,
                                path: p,
                              })}
                            />
                          </div>
                        )
                      : paneFile
                        ? (
                            <div className="min-h-0 flex-1">
                              <PreviewBody
                                entry={paneFile}
                                client={client}
                                labels={labels}
                                editable={features.edit}
                                previewers={pluginPreviewers}
                                actions={paneActions}
                                onDirtyChange={(d) => {
                                  paneDirtyRef.current = d;
                                }}
                              />
                            </div>
                          )
                        : (
                            <ContextMenu>
                              <ContextMenuTrigger render={<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center" />}>
                                <FolderOpenIcon className="size-10 text-muted-foreground/60" />
                                <div className="font-medium">
                                  {path === "/"
                                    ? currentMount?.label
                                    : basename(path)}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {listing.isPending
                                    ? labels.loading
                                    : labels.folderItems(entries.length, !!listing.hasNextPage)}
                                </div>
                                <div className="text-sm text-muted-foreground">{labels.selectFileHint}</div>
                                {canUpload && (
                                  <button
                                    type="button"
                                    className="mt-2 flex flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-4 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                                    onClick={() => pickFiles(fileInputRef.current)}
                                  >
                                    <UploadIcon className="size-4" />
                                    {labels.dropOrClick}
                                  </button>
                                )}
                              </ContextMenuTrigger>
                              {menuContent(blankMenu())}
                            </ContextMenu>
                          ))
                  : (
                      <ContextMenu>
                        <ContextMenuTrigger
                          render={<div className="flex min-h-0 flex-1 flex-col" />}
                          onContextMenu={(e) => {
                            if (!(e.target as HTMLElement).closest("[data-path]"))
                              setRawSelection(EMPTY_SELECTION);
                          }}
                        >
                          <FileList
                            compact={narrow}
                            entries={entries}
                            view={view}
                            selection={selection}
                            labels={labels}
                            client={client}
                            sort={sort.key}
                            order={sort.order}
                            onSort={key => setSort(s => ({
                              key,
                              order: s.key === key && s.order === "asc"
                                ? "desc"
                                : "asc",
                            }))}
                            onSelect={onSelect}
                            onClearSelection={() => setRawSelection(EMPTY_SELECTION)}
                            onSelectPaths={pick && !pick.multiple
                              ? undefined
                              : paths => setRawSelection({
                                paths: new Set(paths),
                                anchor: paths[0],
                              })}
                            onOpen={openEntry}
                            onEntryContextMenu={e => !selection.paths.has(e.path) && setRawSelection({
                              paths: new Set([e.path]),
                              anchor: e.path,
                            })}
                            onDropOnFolder={(paths, folder) => runOps({
                              op: "move",
                              paths,
                              dest: folder.path,
                              conflict: "rename",
                            })}
                            showParent={below}
                            thumbnails={!!currentMount?.thumbnails}
                            changes={mount
                              ? changeIndex.get(mount)
                              : undefined}
                            hasMore={!below && !!listing.hasNextPage && !listing.isFetchingNextPage}
                            onLoadMore={() => void listing.fetchNextPage()}
                            disabled={pick && (e => e.kind === "file" && !acceptsEntry(e, pick.accept))}
                            empty={(
                              <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
                                {(below
                                  ? search.isPending
                                  : listing.isPending)
                                  ? labels.loading
                                  : (unfiltered.length > 0
                                      ? (
                                          <span className="flex flex-col items-center gap-2">
                                            {labels.noFilterMatches}
                                            <Button size="sm" variant="outline" onClick={() => changeFilters(NO_FILTERS)}>{labels.clearFilters}</Button>
                                          </span>
                                        )
                                      : query.trim()
                                        ? labels.noMatches
                                        : labels.emptyFolder)}
                              </div>
                            )}
                          />
                        </ContextMenuTrigger>
                        {menuContent(selected.length
                          ? entryMenu(selected)
                          : blankMenu())}
                      </ContextMenu>
                    )}

              {dropzone.isDragActive && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 ring-2 ring-primary ring-inset">
                  <span className="rounded-md bg-background px-3 py-1.5 text-sm shadow">{labels.dropHere}</span>
                </div>
              )}

              {pick && (() => {
                const total = selected.reduce((n, e) => n + e.size, 0);
                const over = pick.maxTotalSize !== undefined && total > pick.maxTotalSize;
                return (
                  <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-sm" data-fm-pick-bar="">
                    <span>{labels.selected(selected.length)}</span>
                    <span className="text-muted-foreground tabular-nums">{labels.pickTotal(formatSize(total))}</span>
                    {over && <span role="alert" className="text-destructive">{labels.pickOverLimit(formatSize(pick.maxTotalSize!))}</span>}
                    <span className="flex-1" />
                    {pick.onCancel && <Button size="sm" variant="ghost" onClick={pick.onCancel}>{labels.cancel}</Button>}
                    <Button size="sm" disabled={selected.length === 0 || over} onClick={() => pick.onPick(selected)}>{labels.confirm}</Button>
                  </footer>
                );
              })()}
            </section>
          </ResizablePanel>

          {sideDetails && detailsEntry && <ResizableHandle withHandle aria-label={labels.resizeDetails} />}
          {sideDetails && detailsEntry && (
            <ResizablePanel id="details" defaultSize="288px" minSize="220px" maxSize="50%">
              <DetailsPanel
                key={detailsEntry.path}
                entry={detailsEntry}
                mountLabel={currentMount?.label ?? ""}
                client={client}
                labels={labels}
                overlay={false}
                onClose={() => setDetailsOpen(false)}
              />
            </ResizablePanel>
          )}
        </ResizablePanelGroup>

        {treeOnly && <div className="absolute inset-0 z-10 flex flex-col bg-background">{treePane}</div>}

        {detailsEntry && narrow && (
          <DetailsPanel
            key={detailsEntry.path}
            entry={detailsEntry}
            mountLabel={currentMount?.label ?? ""}
            client={client}
            labels={labels}
            overlay
            onClose={() => setDetailsOpen(false)}
          />
        )}

        <input ref={fileInputRef} type="file" multiple hidden onChange={onPick} />
        <input ref={folderInputRef} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={onPick} />

        <UploadPanel queue={queue} labels={labels} />

        {notice && (
          <div role="status" className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground py-1.5 pr-1.5 pl-4 text-sm text-background shadow-lg">
            <span>{notice.message}</span>
            {notice.undo && (
              <Button size="sm" variant="ghost" className="text-background hover:bg-background/15 hover:text-background" onClick={notice.undo}>
                {labels.undo}
              </Button>
            )}
            <IconButton size="icon-xs" label={labels.close} className="text-background hover:bg-background/15 hover:text-background" onClick={() => setNotice(undefined)}><XIcon /></IconButton>
          </div>
        )}

        {review && reviewer && !explorer && (
          <ReviewDialog
            reviewer={reviewer}
            client={client}
            mount={review.mount}
            labels={labels}
            title={review.path ?? labels.changes}
            changes={changeQueries[changeMounts.indexOf(review.mount)]?.data ?? []}
            path={review.path}
            onClose={() => setReview(undefined)}
            onOpenFile={(p) => {
              setReview(undefined);
              void client.stat(review.mount, p).then(e => setPreview(maskEntry(e, features)), () => {});
            }}
          />
        )}

        {preview && (
          <PreviewDialog
          // The listing's copy carries the latest etag after a save from the preview.
            entry={(preview.mount === mount && byPath.get(preview.path)) || preview}
            siblings={entries.filter(e => e.kind === "file")}
            client={client}
            labels={labels}
            editable={features.edit}
            previewers={pluginPreviewers}
            onNavigate={setPreview}
            {...(features.download
              ? {
                  onDownload: (e: FmEntry) => download([e]),
                }
              : {})}
            onClose={() => setPreview(undefined)}
          />
        )}

        {pendingNav && (
          <DiscardChangesDialog
            labels={labels}
            onCancel={() => setPendingNav(undefined)}
            onDiscard={() => {
              paneDirtyRef.current = false;
              setPendingNav(undefined);
              pendingNav();
              // After the editor's unmount flush, so the draft does not come back.
              if (paneFile)
                setTimeout(clearDraft, 0, paneFile.mount, paneFile.path);
            }}
          />
        )}

        {canQuickOpen && (
          <QuickOpen
            client={client}
            mount={mount}
            labels={labels}
            open={quickOpen}
            onOpenChange={setQuickOpen}
            onPick={pickQuickOpen}
            filter={filter}
          />
        )}

        {dialog?.kind === "mkdir" && mount && (
          <NameDialog
            title={labels.newFolder}
            initial={labels.newFolder}
            submitLabel={labels.create}
            labels={labels}
            onClose={() => setDialog(undefined)}
            onSubmit={(name) => {
              setDialog(undefined);
              const to = dialog.to ?? { mount, path };
              void ask().then((message) => {
                if (message === null)
                  return;
                client.mkdir(to.mount, joinPath(to.path, name), { message }).then(() => {
                  used();
                  addPendingFolder(to.mount, joinPath(to.path, name));
                  void refreshMount(to.mount);
                }, (e: Error) => setError(e.message));
              });
            }}
          />
        )}
        {dialog?.kind === "newFile" && mount && (
          <NameDialog
            title={labels.newFile}
            initial={labels.untitled}
            submitLabel={labels.create}
            labels={labels}
            onClose={() => setDialog(undefined)}
            onSubmit={(name) => {
              setDialog(undefined);
              const to = dialog.to ?? { mount, path };
              void ask().then((message) => {
                if (message === null)
                  return;
                client.write(to.mount, joinPath(to.path, name), "", { conflict: "fail", message }).then((e) => {
                  used();
                  void refreshMount(to.mount);
                  setPreview(e);
                }, (e: Error) => setError(e.message));
              });
            }}
          />
        )}
        {dialog?.kind === "rename" && (
          <NameDialog
            title={labels.rename}
            initial={dialog.entry.name}
            submitLabel={labels.rename}
            labels={labels}
            onClose={() => setDialog(undefined)}
            onSubmit={(name) => {
              setDialog(undefined);
              if (name === basename(dialog.entry.path))
                return;
              const renamed = dialog.entry;
              runOps({ op: "rename", path: renamed.path, name }, () => {
              // Keep showing a renamed open file under its new name.
                if (renamed.kind === "file" && renamed.mount === openFile?.mount && renamed.path === openFile.path) {
                  reveal({
                    ...renamed,
                    name,
                    path: joinPath(dirname(renamed.path), name),
                  });
                }
              }, renamed.mount);
            }}
          />
        )}
        {dialog?.kind === "delete" && (
          <ConfirmDeleteDialog
            count={dialog.paths.length}
            labels={labels}
            onClose={() => setDialog(undefined)}
            onConfirm={() => {
              setDialog(undefined);
              runOps({ op: "delete", paths: dialog.paths }, dialog.after, dialog.mount);
            }}
          />
        )}
        {dialog?.kind === "emptyTrash" && mount && (
          <ConfirmDeleteDialog
            count={trashItems.length}
            title={labels.confirmEmptyTrash}
            labels={labels}
            onClose={() => setDialog(undefined)}
            onConfirm={() => {
              setDialog(undefined);
              void ask().then((message) => {
                if (message === null)
                  return;
                mutations.purge.mutate({ message }, {
                  onSuccess: (res) => {
                    used();
                    setError(failedMessage(res.results));
                  },
                  onError: e => setError(e.message),
                });
              });
            }}
          />
        )}
        {dialog?.kind === "manageDrives" && mounts.data && (
          <ManageDrivesDialog
            mounts={visibleMounts(mounts.data, hostHidden, [], undefined)}
            hidden={userHidden}
            current={mount}
            labels={labels}
            onChange={setUserHidden}
            onClose={() => setDialog(undefined)}
          />
        )}
        {dialog?.kind === "uploadConflict" && (
          <UploadConflictDialog
            count={dialog.clashes.size}
            labels={labels}
            onClose={() => setDialog(undefined)}
            onChoose={(choice) => {
              const { files, clashes } = dialog;
              setDialog(undefined);
              const clash = (f: FmUploadFile) => clashes.has(topName(f)) && !(f.relativePath ?? "").includes("/");
              queue.getState().enqueue(dialog.to.mount, dialog.to.path, choice === "skip"
                ? files.filter(f => !clash(f))
                : files.map(f => (clash(f)
                    ? { ...f, conflict: choice }
                    : f)));
            }}
          />
        )}
        {changeMessage.asking && <ChangeMessageDialog asking={changeMessage.asking} labels={labels} />}
      </div>
    </ChangeMessageContext>
  );
}
