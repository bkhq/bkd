import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";
import type { FmUploadFile, FmUploadTask } from "../client/upload";
import type { FmEntry, FmOpsRequest } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmFolderRef } from "./manager-shared";
import type { FmClipboard, FmSelectMode } from "./state";
import type { FmUndo } from "./undo";
import type { FmChangesState } from "./use-changes";

import type { FmListingState } from "./use-listing-state";
import type { FmViewState } from "./use-view-state";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

import { fmKeys, useFmMutations, useTrash } from "../client/hooks";
import { createUploadQueue, xhrTransport } from "../client/upload";
import { absolutePath, dirname, joinPath, relativePath } from "../core/path";
import { clearDrafts } from "./drafts";
import { filesFromDropzone, filesFromInput } from "./drop";
import { maskEntry } from "./features";
import { readLast, topName, triggerDownload } from "./manager-shared";
import { visibleMounts } from "./mount-visibility";
import { EMPTY_SELECTION, prune, select, step } from "./state";
import { undoFor } from "./undo";

export function useCommands(props: FileManagerProps, v: FmViewState, l: FmListingState, c: FmChangesState) {
  const {
    drive,
    client,
    setLocation,
    userHidden,
    query,
    setQuery,
    setSearchScope,
    setNarrowPane,
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
    ask,
    used,
    path,
    inTrash,
    labels,
    qc,
    mounts,
    features,
    storageKey,
    mount,
    guard,
    uploadToRef,
    dropPendingFolders,
    pick,
    listing,
    below,
    search,
    pendingHere,
    entries,
    dir,
    order,
    byPath,
    pickable,
    selection,
    selected,
    explorer,
    paneFile,
    setReview,
    reviewer,
    openChangeRef,
  } = {
    ...v,
    ...l,
    ...c,
  };
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
  }, [notice, setNotice]);

  const go = useCallback((m: string, p: string, trash: boolean) => {
    setLocation({ mount: m, path: p, trash });
    setRawSelection(EMPTY_SELECTION);
    setQuery("");
    setSearchScope("folder");
    setError(undefined);
  }, [
    setLocation,
    setRawSelection,
    setQuery,
    setSearchScope,
    setError,
  ]);
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
  const canQuickOpen = !drive && features.search && !inTrash && !!mount;

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
    setRawSelection,
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
  const pasteInto = (to: FmFolderRef) => {
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
  const upload = async (files: FmUploadFile[], to?: FmFolderRef) => {
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

  const pickFiles = (input: HTMLInputElement | null, to?: FmFolderRef) => {
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
    // By code: Option changes `e.key` on macOS.
    if (mod && e.altKey && e.code === "KeyC") {
      const root = one && mounts.data?.find(m => m.id === one.mount)?.absoluteRoot;
      if (one && e.shiftKey)
        void copyText(relativePath(one.path), labels.pathCopied);
      else if (one && root !== undefined)
        void copyText(absolutePath(root, one.path), labels.pathCopied);
      e.preventDefault();
      return;
    }
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
  return {
    queue,
    restored,
    setRestored,
    mutations,
    canWrite,
    canUpload,
    canMkdir,
    canNewFile,
    refreshMount,
    mountWritable,
    onUploadedRef,
    mountsRef,
    shownError,
    currentMount,
    trashItems,
    go,
    navigate,
    changeQuery,
    failedMessage,
    runUndo,
    doneMessage,
    runOps,
    requestDelete,
    reveal,
    openChange,
    open,
    openEntry,
    pickQuickOpen,
    canQuickOpen,
    lastKey,
    restoreRef,
    shownFile,
    download,
    copyToClipboard,
    canPaste,
    pasteInto,
    paste,
    dropEntries,
    copyContents,
    copyText,
    upload,
    pickFiles,
    onPick,
    onSelect,
    onKeyDown,
    onPasteFiles,
    dropzone,
  };
}

export type FmCommands = ReturnType<typeof useCommands>;
