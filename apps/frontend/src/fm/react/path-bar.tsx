import type { DragEvent, ReactNode } from "react";
import type { FmClient, FmListFilter } from "../client/client";
import type { FmEntry, FmMountInfo } from "../core/schema";
import type { FmLabels } from "./labels";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useListing } from "../client/hooks";
import { basename, dirname } from "../core/path";
import { DRAG_TYPE, EntryIcon } from "./file-list";
import { MenuScroll } from "./menu-scroll";
import { springDrag, springKey } from "./spring-load";

/** A picker: one line per entry, capped in width and height. */
const PICKER = "w-auto max-w-72 min-w-40 overflow-hidden p-0";
const PICKER_ITEM = "gap-1.5 py-1 text-xs whitespace-nowrap";

/** Entries of `path`: folders unfold into their own entries (and open on click with `onOpenFolder`), files open. */
function PickerEntries({ client, mount, path, current, labels, filter, onOpenFile, onOpenFolder }: {
  client: FmClient;
  mount: string;
  path: string;
  current: string;
  labels: FmLabels;
  filter: FmListFilter | undefined;
  onOpenFile: (entry: FmEntry) => void;
  onOpenFolder?: ((entry: FmEntry) => void) | undefined;
}) {
  const listing = useListing(client, mount, path, "name", "asc", "", filter);
  const entries = listing.data?.pages.flatMap(p => p.items) ?? [];
  if (listing.isSuccess && entries.length === 0)
    return <DropdownMenuItem disabled className={PICKER_ITEM}>{labels.emptyFolder}</DropdownMenuItem>;
  return entries.map((entry) => {
    const here = entry.path === current;
    if (entry.kind === "dir") {
      return (
        <DropdownMenuSub key={entry.path}>
          <DropdownMenuSubTrigger className={cn(PICKER_ITEM, here && "font-medium")} title={entry.name} onClick={onOpenFolder && (() => onOpenFolder(entry))}>
            <EntryIcon entry={entry} className="size-3.5" />
            <span className="truncate">{entry.name}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={PICKER}>
            <MenuScroll>
              <PickerEntries client={client} mount={mount} path={entry.path} current={current} labels={labels} filter={filter} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} />
            </MenuScroll>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }
    return (
      <DropdownMenuItem key={entry.path} className={cn(PICKER_ITEM, here && "font-medium")} title={entry.name} onClick={() => onOpenFile(entry)}>
        <EntryIcon entry={entry} className="size-3.5" />
        <span className="truncate">{entry.name}</span>
      </DropdownMenuItem>
    );
  });
}

/**
 * Editor-style path of the open file (or of the current folder when none is
 * open): the mount, each folder and the file. A folder step goes to that folder;
 * the separator after it opens a picker of what the folder holds (folders unfold,
 * files open). The last step opens a picker of what sits beside it.
 */
export function PathBar({ client, mounts, mount, path, file, labels, filter, root, className, onNavigate, onOpenFile, onOpenFolder }: {
  client: FmClient;
  mounts: FmMountInfo[];
  /** Current mount and folder, shown while no file is open. */
  mount: string;
  path: string;
  file?: FmEntry | undefined;
  labels: FmLabels;
  /** Hidden / ignored filter for the pickers. */
  filter?: FmListFilter | undefined;
  /** Replaces the mount step. */
  root?: ReactNode | undefined;
  className?: string | undefined;
  /** Clicking a folder step that is not the last one. */
  onNavigate: (path: string) => void;
  onOpenFile: (entry: FmEntry) => void;
  /** Clicking a folder in a picker opens it; without it folders only unfold. */
  onOpenFolder?: ((entry: FmEntry) => void) | undefined;
}) {
  const [openStep, setOpenStep] = useState<string>();
  const at = file?.mount ?? mount;
  const dir = file
    ? dirname(file.path)
    : path;
  const folders = dir === "/"
    ? []
    : dir.slice(1).split("/").map((_, i, parts) => `/${parts.slice(0, i + 1).join("/")}`);
  const trail = file
    ? [...folders, file.path]
    : folders;
  /** Drag handlers of a folder crumb: a drag resting on it opens the folder (needs `onOpenFolder`). */
  const spring = (target: string) => {
    const info = mounts.find(m => m.id === at);
    if (!onOpenFolder || !info || target === dir || (file && target === file.path))
      return {};
    const key = springKey(at, target);
    const folder: FmEntry = {
      mount: at,
      path: target,
      name: basename(target) || info.label,
      kind: "dir",
      size: 0,
      mtime: "",
      etag: "",
      caps: info.caps,
    };
    return {
      onDragOver: (e: DragEvent) => springDrag.over(e.dataTransfer.types, DRAG_TYPE, key, () => onOpenFolder(folder)),
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          springDrag.leave(key);
      },
      onDrop: springDrag.end,
    };
  };
  const crumb = (last: boolean) => cn("max-w-48 shrink-0 truncate rounded-sm px-1 py-0.5 hover:bg-muted hover:text-foreground", last
    ? "font-medium text-foreground"
    : "text-muted-foreground");
  const picker = (key: string, folder: string, current: string, trigger: ReactNode) => (
    <DropdownMenu
      open={openStep === key}
      onOpenChange={o => setOpenStep(o
        ? key
        : undefined)}
    >
      {trigger}
      <DropdownMenuContent align="start" className={PICKER}>
        <MenuScroll>
          <PickerEntries
            client={client}
            mount={at}
            path={folder}
            current={current}
            labels={labels}
            filter={filter}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder && ((e) => {
              setOpenStep(undefined);
              onOpenFolder(e);
            })}
          />
        </MenuScroll>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const step = (target: string, label: string, last: boolean) => last
    ? picker(
        target,
        target === "/"
          ? "/"
          : dirname(target),
        target,
        <DropdownMenuTrigger render={<button type="button" className={crumb(true)} {...spring(target)} />}>{label}</DropdownMenuTrigger>,
      )
    : <button type="button" className={crumb(false)} onClick={() => onNavigate(target)} {...spring(target)}>{label}</button>;
  const mountLabel = mounts.find(m => m.id === at)?.label ?? at;
  /** Separator after `folder`: opens the picker of its entries, with the next step marked. */
  const separator = (folder: string, next: string) => picker(
    `>${folder}`,
    folder,
    next,
    <DropdownMenuTrigger render={<button type="button" className="shrink-0 rounded-sm py-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={labels.folderContents(basename(folder) || mountLabel)} />}>
      <ChevronRightIcon className="size-3.5" />
    </DropdownMenuTrigger>,
  );
  return (
    <nav aria-label={labels.path} className={cn("flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 text-sm whitespace-nowrap [scrollbar-width:none]", className)}>
      {/* Keyed apart: `root` often arrives after the first render and must not inherit the step's controlled menu. */}
      {root
        ? <Fragment key="root">{root}</Fragment>
        : <Fragment key="/">{step("/", mountLabel, trail.length === 0)}</Fragment>}
      {trail.map((target, i) => (
        <Fragment key={target}>
          {separator(trail[i - 1] ?? "/", target)}
          {step(target, basename(target), i === trail.length - 1)}
        </Fragment>
      ))}
    </nav>
  );
}
