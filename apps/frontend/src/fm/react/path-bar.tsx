import type { FmClient, FmListFilter } from "../client/client";
import type { FmEntry, FmMountInfo } from "../core/schema";
import type { FmLabels } from "./labels";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { Fragment } from "react";
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
import { EntryIcon } from "./file-list";
import { MenuScroll } from "./menu-scroll";

/** A picker: one line per entry, capped in width and height. */
const PICKER = "w-auto max-w-72 min-w-40 overflow-hidden p-0";
const PICKER_ITEM = "gap-1.5 py-1 text-xs whitespace-nowrap";

/** Entries of `path`: folders unfold into their own entries, files open. */
function PickerEntries({ client, mount, path, current, labels, filter, onOpenFile }: {
  client: FmClient;
  mount: string;
  path: string;
  current: string;
  labels: FmLabels;
  filter: FmListFilter | undefined;
  onOpenFile: (entry: FmEntry) => void;
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
          <DropdownMenuSubTrigger className={cn(PICKER_ITEM, here && "font-medium")} title={entry.name}>
            <EntryIcon entry={entry} className="size-3.5" />
            <span className="truncate">{entry.name}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className={PICKER}>
            <MenuScroll>
              <PickerEntries client={client} mount={mount} path={entry.path} current={current} labels={labels} filter={filter} onOpenFile={onOpenFile} />
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
 * open): the mount, each folder and the file. Every step opens a picker of what
 * sits beside it: folders unfold, files open.
 */
export function PathBar({ client, mounts, mount, path, file, labels, filter, onOpenFile }: {
  client: FmClient;
  mounts: FmMountInfo[];
  /** Current mount and folder, shown while no file is open. */
  mount: string;
  path: string;
  file?: FmEntry | undefined;
  labels: FmLabels;
  /** Hidden / ignored filter for the pickers. */
  filter?: FmListFilter | undefined;
  onOpenFile: (entry: FmEntry) => void;
}) {
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
  const crumb = (last: boolean) => cn("max-w-48 shrink-0 truncate rounded-sm px-1 py-0.5 hover:bg-muted hover:text-foreground", last
    ? "font-medium text-foreground"
    : "text-muted-foreground");
  const step = (target: string, label: string, last: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={crumb(last)} />}>{label}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={PICKER}>
        <MenuScroll>
          <PickerEntries
            client={client}
            mount={at}
            path={target === "/"
              ? "/"
              : dirname(target)}
            current={target === "/"
              ? trail[0] ?? ""
              : target}
            labels={labels}
            filter={filter}
            onOpenFile={onOpenFile}
          />
        </MenuScroll>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <nav aria-label={labels.path} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 text-sm whitespace-nowrap [scrollbar-width:none]">
      {step("/", mounts.find(m => m.id === at)?.label ?? at, trail.length === 0)}
      {trail.map((target, i) => (
        <Fragment key={target}>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
          {step(target, basename(target), i === trail.length - 1)}
        </Fragment>
      ))}
    </nav>
  );
}
