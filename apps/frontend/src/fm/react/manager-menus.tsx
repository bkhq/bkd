import type { ReactNode } from "react";
import type { FmEntry } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmFolderRef } from "./manager-shared";
import type { FmActionContext, FmFileAction } from "./plugins";
import type { FmMenuItems } from "./tidy-menu";
import type { FmChangesState } from "./use-changes";
import type { FmCommands } from "./use-commands";
import type { FmListingState } from "./use-listing-state";
import type { FmViewState } from "./use-view-state";
import {
  ClipboardCopyIcon,
  ClipboardPasteIcon,
  CopyIcon,
  CopyPlusIcon,
  DownloadIcon,
  EyeIcon,
  FilePlusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitCompareIcon,
  InfoIcon,
  PencilIcon,
  RefreshCwIcon,
  ScissorsIcon,
  StarIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";

import { fmKeys } from "../client/hooks";
import { KEYS } from "./manager-shared";
import { kindOf } from "./state";
import { tidyMenu } from "./tidy-menu";

export function createMenus(props: FileManagerProps, v: FmViewState, l: FmListingState, c: FmChangesState, d: FmCommands) {
  const {
    client,
    clipboard,
    setPreview,
    setDialog,
    setError,
    setDetailsOpen,
    path,
    inTrash,
    labels,
    qc,
    features,
    mount,
    fileInputRef,
    listing,
    meta,
    isStarred,
    toggleStar,
    reviewer,
    changeIndex,
    canWrite,
    canUpload,
    canMkdir,
    canNewFile,
    refreshMount,
    mountWritable,
    runOps,
    requestDelete,
    reveal,
    openChange,
    open,
    download,
    copyToClipboard,
    canPaste,
    pasteInto,
    paste,
    copyContents,
    copyText,
    pickFiles,
  } = {
    ...v,
    ...l,
    ...c,
    ...d,
  };
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

  const runAction = (action: FmFileAction, targets: FmEntry[], at?: FmFolderRef) => {
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
  const hereMenu = (to: FmFolderRef, writable: boolean) => [
    menuItem("newFileHere", labels.newFileHere, <FilePlusIcon />, () => setDialog({ kind: "newFile", to }), { show: writable && features.createFile }),
    menuItem("newFolderHere", labels.newFolderHere, <FolderPlusIcon />, () => setDialog({ kind: "mkdir", to }), { show: writable && features.createFolder }),
    menuItem("uploadHere", labels.uploadHere, <UploadIcon />, () => pickFiles(fileInputRef.current, to), { show: writable && features.upload }),
  ];

  /** `from`: folder holding the targets when it is not the current one (tree folder rows). */
  const entryMenu = (targets: FmEntry[], from?: FmFolderRef) => {
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
  return {
    menuItem,
    menuContent,
    runAction,
    hereMenu,
    entryMenu,
    blankMenu,
    mountMenu,
  };
}
