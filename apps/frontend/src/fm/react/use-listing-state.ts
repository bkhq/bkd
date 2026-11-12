import type { FmEntry } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmListFilters } from "./filters";
import type { FmViewState } from "./use-view-state";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FmApiError } from "../client/client";
import { useListing, useSearch } from "../client/hooks";
import { dirname } from "../core/path";
import { acceptsEntry } from "./accept";
import { useColumnValues } from "./columns";
import { maskEntry } from "./features";
import { applyFilters, hasFilters } from "./filters";
import { useStoredFilters } from "./manager-shared";
import { prune } from "./state";

export function useListingState(props: FileManagerProps, v: FmViewState) {
  const {
    drive,
    client,
    query,
    searchScope,
    sort,
    rawSelection,
    path,
    inTrash,
    features,
    storageKey,
    mount,
    filter,
    split,
    paneDirtyRef,
    pendingIn,
    isPending,
    withPending,
  } = { ...v };
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
  const columns = props.columns;
  const columnValues = useColumnValues(columns, unfiltered);
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
  // The drive lists the folder beside its tree and opens files in the preview dialog.
  const explorer = split && !pick && !drive;
  const [openFile, setOpenFile] = useState<FmEntry>();
  // Set by a folder step of the path bar: with no file open, the pane lists the current folder.
  const [folderList, setFolderList] = useState(false);
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
  }, [paneFile?.path, paneDirtyRef]);
  return {
    columns,
    columnValues,
    filtersFor,
    setFiltersFor,
    openFile,
    setOpenFile,
    folderList,
    setFolderList,
    pick,
    listing,
    below,
    search,
    items,
    filters,
    changeFilters,
    pendingHere,
    unfiltered,
    entries,
    treeFilter,
    rawDir,
    hasIgnored,
    dir,
    order,
    byPath,
    pickable,
    selection,
    selected,
    explorer,
    picked,
    paneFile,
  };
}

export type FmListingState = ReturnType<typeof useListingState>;
