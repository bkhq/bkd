import type { FmEntry, FmSortKey } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmTreeTarget } from "./file-tree";
import type { FmDialogState, FmFolderRef } from "./manager-shared";
import type { FmClipboard, FmSelection } from "./state";
import { useQueryClient } from "@tanstack/react-query";

import { useCallback, useMemo, useRef, useState } from "react";

import { createFmClient } from "../client/client";
import { useMounts } from "../client/hooks";
import { basename, dirname, isWithin } from "../core/path";
import { READ_ONLY_CAPS } from "../core/schema";
import { useChangeMessageState } from "./change-message";
import { resolveFeatures } from "./features";
import { enLabels } from "./labels";
import { NARROW, onPathKeys, useStoredChoice, useStoredList, useWidth } from "./manager-shared";
import { visibleMounts } from "./mount-visibility";
import { EMPTY_SELECTION } from "./state";

export function useViewState(props: FileManagerProps, mode: "workspace" | "drive") {
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
    // The drive also opens the listed folder, like a file explorer.
    if (mode === "drive" && !inTrash && path !== "/")
      keys.push(`${mount}:${path}`);
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
  const drive = mode === "drive";
  const [view, setView] = useStoredChoice(drive
    ? `${storageKey}:drive:view`
    : `${storageKey}:view`, ["list", "grid"], drive
    ? "grid"
    : "list");
  const [layout, setLayout] = useStoredChoice(`${storageKey}:layout`, ["split", "single"], props.layout ?? "split");
  const [hiddenFiles, setHiddenFiles] = useStoredChoice(`${storageKey}:hidden-files`, ["on", "off"], "off");
  const [ignoredFiles, setIgnoredFiles] = useStoredChoice(`${storageKey}:ignored-files`, ["on", "off"], "on");
  // The drive view has no toggles for these.
  const showHidden = !drive && hiddenFiles === "on";
  const showIgnored = drive || ignoredFiles === "on";
  const filter = useMemo(() => ({ hidden: showHidden, ignored: showIgnored }), [showHidden, showIgnored]);
  const [rootRef, width] = useWidth();
  const narrow = width > 0 && width < NARROW;
  // Narrow containers show the tree or the main pane, one at a time; the picker keeps the list.
  // The drive always shows its tree beside the folder.
  const tree = drive || layout === "split";
  const stacked = narrow && tree && !props.pick;
  const split = tree && (!narrow || stacked);
  const [narrowPane, setNarrowPane] = useState<"tree" | "main">("tree");
  const treeOnly = stacked && narrowPane === "tree";
  const [sort, setSort] = useState<{ key: FmSortKey; order: "asc" | "desc" }>({ key: "name", order: "asc" });
  const [rawSelection, setRawSelection] = useState<FmSelection>(EMPTY_SELECTION);
  const [clipboard, setClipboard] = useState<FmClipboard>();
  const [preview, setPreview] = useState<FmEntry>();
  const [dialog, setDialog] = useState<FmDialogState>();
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
  const uploadToRef = useRef<FmFolderRef | undefined>(undefined);

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
  return {
    drive,
    client,
    location,
    setLocation,
    userHidden,
    setUserHidden,
    expanded,
    setExpanded,
    pathRows,
    setPathRows,
    query,
    setQuery,
    searchScope,
    setSearchScope,
    view,
    setView,
    layout,
    setLayout,
    hiddenFiles,
    setHiddenFiles,
    ignoredFiles,
    setIgnoredFiles,
    rootRef,
    width,
    narrowPane,
    setNarrowPane,
    sort,
    setSort,
    rawSelection,
    setRawSelection,
    clipboard,
    setClipboard,
    preview,
    setPreview,
    dialog,
    setDialog,
    quickOpen,
    setQuickOpen,
    error,
    setError,
    notice,
    setNotice,
    detailsOpen,
    setDetailsOpen,
    pendingNav,
    setPendingNav,
    paneActions,
    setPaneActions,
    treeTarget,
    setTreeTarget,
    pendingFolders,
    setPendingFolders,
    ask,
    used,
    path,
    inTrash,
    labels,
    changeMessageRef,
    changeMessage,
    qc,
    mounts,
    pluginPreviewers,
    features,
    storageKey,
    hostHidden,
    mount,
    shownMounts,
    canManageDrives,
    at,
    setRowExpanded,
    collapseAll,
    showHidden,
    showIgnored,
    filter,
    narrow,
    stacked,
    split,
    treeOnly,
    paneDirtyRef,
    guard,
    fileInputRef,
    treeTargetRef,
    folderInputRef,
    uploadToRef,
    pendingIn,
    isPending,
    addPendingFolder,
    dropPendingFolders,
    withPending,
  };
}

export type FmViewState = ReturnType<typeof useViewState>;
