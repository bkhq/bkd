import type { FmEntry } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmListingState } from "./use-listing-state";
import type { FmViewState } from "./use-view-state";

import { useQueries } from "@tanstack/react-query";
import {
  GitCompareIcon,
  HistoryIcon,
  StarIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { changesQuery } from "../client/hooks";
import { basename } from "../core/path";
import { indexChanges } from "./changes";
import { maskEntry } from "./features";
import { useStoredChoice } from "./manager-shared";
import { metaKey, useMetaEntries } from "./meta";

export function useChanges(props: FileManagerProps, v: FmViewState, l: FmListingState) {
  const {
    drive,
    client,
    preview,
    setPreview,
    setError,
    labels,
    qc,
    features,
    storageKey,
    shownMounts,
    paneFile,
  } = {
    ...v,
    ...l,
  };
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
  const changeMounts = useMemo(() => (drive
    ? []
    : (shownMounts ?? []).filter(m => m.changes).map(m => m.id)), [drive, shownMounts]);
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

  // Drive: a starred / recent file opens in the preview dialog.
  const previewEntry = useCallback((e: FmEntry) => setPreview(maskEntry(e, features)), [setPreview, features]);

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
    ...(meta?.starred && (drive || showStarred === "on")
      ? [
          {
            id: "starred",
            label: labels.starred,
            icon: <StarIcon className="text-amber-500" />,
            entries: starred.data ?? [],
            ...(drive
              ? { onOpen: previewEntry }
              : {}),
          },
        ]
      : []),
    ...(meta?.recent && (drive || showRecent === "on")
      ? [
          {
            id: "recent",
            label: labels.recent,
            icon: <HistoryIcon className="text-muted-foreground" />,
            entries: recent.data ?? [],
            ...(drive
              ? { onOpen: previewEntry }
              : {}),
          },
        ]
      : []),
  ], [
    changeEntries,
    changeTotals,
    meta,
    drive,
    previewEntry,
    showStarred,
    showRecent,
    labels,
    starred.data,
    recent.data,
  ]);
  return {
    showStarred,
    setShowStarred,
    showRecent,
    setShowRecent,
    review,
    setReview,
    meta,
    starred,
    recent,
    isStarred,
    toggleStar,
    openedFile,
    touchRef,
    openedMount,
    openedPath,
    reviewer,
    changeMounts,
    changeQueries,
    changesKey,
    changeIndex,
    changesOf,
    openChangeRef,
    changeEntries,
    changeTotals,
    treeSections,
  };
}

export type FmChangesState = ReturnType<typeof useChanges>;
