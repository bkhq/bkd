import type { DragEvent, MouseEvent, ReactNode, PointerEvent as ReactPointerEvent } from "react";
import type { FmClient } from "../client/client";
import type { FmEntry, FmSortKey } from "../core/schema";
import type { FmChangeIndex } from "./changes";
import type { FmColumn } from "./columns";
import type { FmLabels } from "./labels";
import type { FmFileKind, FmSelection, FmSelectMode } from "./state";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "cn";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { dirname } from "../core/path";
import { ChangeBadge } from "./change-badge";
import { CHANGE_STYLE } from "./changes";
import { columnContent } from "./columns";
import { setDownloadUrl } from "./drop";
import { IconButton } from "./icon-button";
import { viewportRef } from "./scroll";
import { springDrag, springKey } from "./spring-load";
import { formatSize, kindOf } from "./state";

export const DRAG_TYPE = "application/x-fm-paths";

const ICONS: Record<FmFileKind, typeof FileIcon> = {
  dir: FolderIcon,
  image: FileImageIcon,
  video: FileVideoIcon,
  audio: FileAudioIcon,
  pdf: FileTextIcon,
  text: FileTextIcon,
  archive: FileArchiveIcon,
  other: FileIcon,
};

export function EntryIcon({ entry, className }: { entry: Pick<FmEntry, "kind" | "name" | "mime">; className?: string }) {
  const kind = kindOf(entry);
  const Icon = ICONS[kind];
  return (
    <Icon className={cn("shrink-0", kind === "dir"
      ? "text-sky-500"
      : "text-muted-foreground", className)}
    />
  );
}

export interface FileListProps {
  entries: readonly FmEntry[];
  view: "list" | "grid";
  /** Narrow layout: hide the modified column; a tap opens entries. */
  compact?: boolean;
  /** Drive look: taller rows, list thumbnails, a more button, square tiles, columns by container width. */
  roomy?: boolean | undefined;
  /** The entry menu is open; selected entries keep their more button shown. */
  menuOpen?: boolean | undefined;
  selection: FmSelection;
  labels: FmLabels;
  client: FmClient;
  sort: FmSortKey;
  order: "asc" | "desc";
  onSort: (key: FmSortKey) => void;
  onSelect: (path: string, mode: FmSelectMode) => void;
  onClearSelection: () => void;
  /** Marquee selection: replaces the selection with `paths`; absent turns the marquee off. */
  onSelectPaths?: ((paths: string[]) => void) | undefined;
  onOpen: (entry: FmEntry) => void;
  /** Right-click on an entry (before the context menu opens). */
  onEntryContextMenu: (entry: FmEntry) => void;
  onDropOnFolder: (paths: string[], folder: FmEntry) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  empty: ReactNode;
  /** Entries shown dimmed with `aria-disabled` (e.g. not pickable). */
  disabled?: ((entry: FmEntry) => boolean) | undefined;
  /** Show each entry's parent folder (search results from several folders). */
  showParent?: boolean;
  /** The mount serves `/thumb`; grid images use it. */
  thumbnails?: boolean;
  /** Review decorations: status of changed entries, dots on folders holding changes. */
  changes?: FmChangeIndex | undefined;
  /** Host columns between name and size (list view). */
  columns?: readonly FmColumn[] | undefined;
}

function modeOf(e: MouseEvent): FmSelectMode {
  return e.shiftKey
    ? "range"
    : (e.metaKey || e.ctrlKey
        ? "toggle"
        : "single");
}

function useEntryHandlers(p: FileListProps, entry: FmEntry) {
  const [over, setOver] = useState(false);
  const selected = p.selection.paths.has(entry.path);
  const isDir = entry.kind === "dir";
  const disabled = !!p.disabled?.(entry);
  const key = springKey(entry.mount, entry.path);
  const springs = isDir && entry.caps.write;
  // A row scrolled away or replaced mid-drag must not open later.
  useEffect(() => () => springDrag.leave(key), [key]);
  return {
    over,
    selected,
    props: {
      "data-path": entry.path,
      "aria-disabled": disabled || undefined,
      "title": disabled
        ? p.labels.pickUnavailable
        : undefined,
      "draggable": entry.caps.move,
      "onClick": (e: MouseEvent) => {
        e.stopPropagation();
        // Touch has no double-click: a tap opens, a long press opens the context menu.
        if ((e.nativeEvent as PointerEvent).pointerType === "touch")
          p.onOpen(entry);
        else
          p.onSelect(entry.path, modeOf(e));
      },
      "onDoubleClick": () => p.onOpen(entry),
      "onContextMenu": () => p.onEntryContextMenu(entry),
      "onDragStart": (e: DragEvent) => {
        const paths = selected
          ? [...p.selection.paths]
          : [entry.path];
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
        springDrag.start(paths.map(x => springKey(entry.mount, x)));
        if (paths.length === 1)
          setDownloadUrl(e.dataTransfer, p.client, entry);
        e.dataTransfer.effectAllowed = "copyMove";
      },
      "onDragEnd": springDrag.end,
      "onDragOver": (e: DragEvent) => {
        if (springs)
          springDrag.over(e.dataTransfer.types, DRAG_TYPE, key, () => p.onOpen(entry));
        if (!springs || !e.dataTransfer.types.includes(DRAG_TYPE))
          return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      },
      "onDragLeave": (e: DragEvent) => {
        setOver(false);
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          springDrag.leave(key);
      },
      "onDrop": (e: DragEvent) => {
        setOver(false);
        springDrag.end();
        if (!isDir || !e.dataTransfer.types.includes(DRAG_TYPE))
          return;
        e.preventDefault();
        e.stopPropagation();
        const paths = (JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[]).filter(x => x !== entry.path);
        if (paths.length)
          p.onDropOnFolder(paths, entry);
      },
    },
  };
}

/** Hides the modified column when there is no room for it. */
function modifiedClass(p: FileListProps, shown: "block" | "flex") {
  if (p.compact)
    return "hidden";
  return p.roomy && (shown === "block"
    ? "hidden @2xl:block"
    : "hidden @2xl:flex");
}

/** Name colour of a changed entry. */
function changeClass(p: FileListProps, entry: FmEntry) {
  const change = p.changes?.byPath.get(entry.path);
  return change && CHANGE_STYLE[change.status].className;
}

const hasThumb = (entry: FmEntry) => kindOf(entry) === "image" && entry.size < 20 * 1024 * 1024;

/** Opens the entry's context menu from a button. */
function MoreButton({ label, className }: { label: string; className: string }) {
  return (
    <IconButton
      size="icon-xs"
      label={label}
      aria-haspopup="menu"
      className={cn("opacity-0 group-hover/entry:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100", className)}
      onClick={(e) => {
        e.stopPropagation();
        const box = e.currentTarget.getBoundingClientRect();
        e.currentTarget.dispatchEvent(new globalThis.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: box.left,
          clientY: box.bottom,
        }));
      }}
      onDoubleClick={e => e.stopPropagation()}
    >
      <MoreHorizontalIcon />
    </IconButton>
  );
}

/** List thumbnail; never loads the full image. */
function ListThumb({ p, entry }: { p: FileListProps; entry: FmEntry }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex size-6 shrink-0 items-center justify-center">
      {p.thumbnails && !failed && hasThumb(entry)
        ? <img src={p.client.thumbUrl(entry.mount, entry.path, 256, entry.etag)} alt="" loading="lazy" draggable={false} className="size-6 rounded-md object-cover" onError={() => setFailed(true)} />
        : <EntryIcon entry={entry} className="size-5" />}
    </span>
  );
}

function ListRow({ p, entry, top }: { p: FileListProps; entry: FmEntry; top: number }) {
  const h = useEntryHandlers(p, entry);
  return (
    <div
      {...h.props}
      role="row"
      aria-selected={h.selected}
      className={cn(
        "absolute inset-x-0 flex h-9 cursor-default items-center gap-3 rounded-md px-3 text-sm select-none hover:bg-muted/60",
        p.roomy && "group/entry h-10",
        h.selected && "bg-accent text-accent-foreground hover:bg-accent",
        h.over && "ring-2 ring-primary",
        h.props["aria-disabled"] && "opacity-50",
        entry.ignored && "opacity-60",
      )}
      style={{ transform: `translateY(${top}px)` }}
    >
      {p.roomy
        ? <ListThumb p={p} entry={entry} />
        : <EntryIcon entry={entry} className="size-4" />}
      <span className={cn("min-w-0 flex-1 truncate", changeClass(p, entry))} role="gridcell">
        {entry.name}
      </span>
      <ChangeBadge change={p.changes?.byPath.get(entry.path)} dir={entry.kind === "dir" && p.changes?.dirs.has(entry.path)} />
      {p.showParent && <span className="max-w-[40%] min-w-0 truncate text-xs text-muted-foreground" role="gridcell">{dirname(entry.path)}</span>}
      {p.columns?.map(c => (
        <span key={c.id} className="shrink-0 truncate text-xs text-muted-foreground" style={{ width: c.width ?? 120 }} role="gridcell" data-fm-column={c.id}>
          {columnContent(c, entry)}
        </span>
      ))}
      <span className={cn("w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums", p.roomy && "hidden @md:block")} role="gridcell">
        {entry.kind === "file"
          ? formatSize(entry.size)
          : ""}
      </span>
      <span className={cn("w-40 shrink-0 text-right text-xs text-muted-foreground tabular-nums", modifiedClass(p, "block"))} role="gridcell">
        {Date.parse(entry.mtime) > 0
          ? new Date(entry.mtime).toLocaleString(p.labels.locale)
          : ""}
      </span>
      {p.roomy && (
        <span className="flex size-6 shrink-0 items-center justify-center" role="gridcell">
          <MoreButton label={p.labels.more} className={cn(h.selected && p.menuOpen && "opacity-100")} />
        </span>
      )}
    </div>
  );
}

function GridCell({ p, entry }: { p: FileListProps; entry: FmEntry }) {
  const h = useEntryHandlers(p, entry);
  const thumb = hasThumb(entry);
  return (
    <div
      {...h.props}
      role="gridcell"
      aria-selected={h.selected}
      className={cn(
        "flex h-full cursor-default flex-col items-center gap-2 rounded-lg p-2 text-xs select-none hover:bg-muted/60",
        p.roomy && "group/entry relative w-40 justify-self-center",
        h.selected && "bg-accent text-accent-foreground hover:bg-accent",
        h.over && "ring-2 ring-primary",
        h.props["aria-disabled"] && "opacity-50",
        entry.ignored && "opacity-60",
      )}
    >
      <div className={cn("flex h-20 w-full items-center justify-center overflow-hidden rounded-md", p.roomy && "aspect-square h-auto shrink-0 bg-muted/40")} data-fm-face={p.roomy ? "" : undefined}>
        {thumb
          ? <GridImage p={p} entry={entry} />
          : <EntryIcon entry={entry} className={p.roomy ? "size-14" : "size-10"} />}
      </div>
      <span className={cn("line-clamp-2 w-full text-center break-all", p.showParent && "line-clamp-1", changeClass(p, entry))}>{entry.name}</span>
      {p.showParent && <span className="w-full truncate text-center text-muted-foreground">{dirname(entry.path)}</span>}
      {p.roomy && <MoreButton label={p.labels.more} className={cn("absolute top-3 right-3 bg-background/80", h.selected && p.menuOpen && "opacity-100")} />}
    </div>
  );
}

/** Grid image: the server thumbnail when the mount has them, the full image otherwise or on error. */
function GridImage({ p, entry }: { p: FileListProps; entry: FmEntry }) {
  const [full, setFull] = useState(!p.thumbnails);
  const src = full
    ? p.client.readUrl(entry.mount, entry.path, { version: entry.etag })
    : p.client.thumbUrl(entry.mount, entry.path, 256, entry.etag);
  return <img src={src} alt="" loading="lazy" draggable={false} className="max-h-full max-w-full object-contain" onError={() => setFull(true)} />;
}

function SortHeader({ p }: { p: FileListProps }) {
  const cell = (key: FmSortKey, label: string, className: string) => (
    <button type="button" className={cn("flex items-center gap-1 hover:text-foreground", className)} onClick={() => p.onSort(key)}>
      {label}
      {p.sort === key && (p.order === "asc"
        ? <ArrowUpIcon className="size-3" />
        : <ArrowDownIcon className="size-3" />)}
    </button>
  );
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b px-3 text-xs text-muted-foreground" role="row">
      <span className={p.roomy ? "size-6 shrink-0" : "size-4"} />
      {cell("name", p.labels.name, "min-w-0 flex-1")}
      {p.columns?.map(c => <span key={c.id} className="shrink-0 truncate" style={{ width: c.width ?? 120 }}>{c.label}</span>)}
      {cell("size", p.labels.size, cn("w-24 justify-end", p.roomy && "hidden @md:flex"))}
      {cell("mtime", p.labels.modified, cn("w-40 justify-end", modifiedClass(p, "flex")))}
      {p.roomy && <span className="size-6 shrink-0" />}
    </div>
  );
}

const ROW = 36;
const CELL_W = 120;
const CELL_H = 132;
const ROOMY_ROW = 40;
const ROOMY_CELL_W = 160;
const ROOMY_CELL_H = 200;
/** Padding of the scroll container (`p-1`). */
const PAD = 4;
/** Pointer travel before a press on empty space becomes a marquee. */
const MARQUEE_MIN = 4;

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Selection kept under the rectangle (Ctrl / Cmd adds to it). */
  base: string[];
  active: boolean;
}

/** Virtualized list / grid of entries. */
export function FileList(p: FileListProps) {
  // The ScrollArea viewport scrolls; the content box below it is measured for the grid columns.
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = contentRef.current;
    if (!el)
      return;
    const ro = new ResizeObserver(([e]) => setWidth(e?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tileW = p.roomy
    ? ROOMY_CELL_W
    : CELL_W;
  const tileH = p.roomy
    ? ROOMY_CELL_H
    : CELL_H;
  const rowH = p.view === "grid"
    ? tileH
    : (p.roomy
        ? ROOMY_ROW
        : ROW);
  const cols = p.view === "grid"
    ? Math.max(1, Math.floor(width / tileW))
    : 1;
  const rows = Math.ceil(p.entries.length / cols);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 8,
  });
  useEffect(() => virtualizer.measure(), [p.view, cols, virtualizer]);

  // Marquee: drag on empty space selects every entry the rectangle touches, rendered or not.
  const [marquee, setMarquee] = useState<Marquee>();
  const marqueeRef = useRef<Marquee | undefined>(undefined);
  const draggedRef = useRef(false);
  const hits = (m: Marquee) => {
    const top = Math.min(m.y0, m.y1) - PAD;
    const bottom = Math.max(m.y0, m.y1) - PAD;
    const left = Math.min(m.x0, m.x1) - PAD;
    const right = Math.max(m.x0, m.x1) - PAD;
    const cellW = width / cols;
    const out: string[] = [];
    for (let r = Math.max(0, Math.floor(top / rowH)); r <= Math.min(rows - 1, Math.floor(bottom / rowH)); r++) {
      for (let c = 0; c < cols; c++) {
        const entry = p.entries[r * cols + c];
        if (entry && (cols === 1 || (c * cellW < right && (c + 1) * cellW > left)) && !p.disabled?.(entry))
          out.push(entry.path);
      }
    }
    return out;
  };
  const toContent = (e: { clientX: number; clientY: number }) => {
    const el = scrollRef.current!;
    const box = el.getBoundingClientRect();
    return { x: e.clientX - box.left + el.scrollLeft, y: e.clientY - box.top + el.scrollTop };
  };
  const update = (m: Marquee) => {
    marqueeRef.current = m;
    setMarquee(m);
    if (m.active) {
      p.onSelectPaths?.([
        ...new Set([
          ...m.base,
          ...hits(m),
        ]),
      ]);
    }
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggedRef.current = false;
    if (!p.onSelectPaths || e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest("[data-path]"))
      return;
    const at = toContent(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    update({
      x0: at.x,
      y0: at.y,
      x1: at.x,
      y1: at.y,
      base: e.ctrlKey || e.metaKey
        ? [...p.selection.paths]
        : [],
      active: false,
    });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const m = marqueeRef.current;
    if (!m)
      return;
    const el = scrollRef.current!;
    const box = el.getBoundingClientRect();
    // Auto-scroll near the edges.
    if (e.clientY < box.top + 24)
      el.scrollTop -= 16;
    else if (e.clientY > box.bottom - 24)
      el.scrollTop += 16;
    const at = toContent(e);
    const active = m.active || Math.hypot(at.x - m.x0, at.y - m.y0) > MARQUEE_MIN;
    update({ ...m, x1: at.x, y1: at.y, active });
  };
  const endMarquee = () => {
    draggedRef.current = !!marqueeRef.current?.active;
    marqueeRef.current = undefined;
    setMarquee(undefined);
  };
  useEffect(() => {
    if (!marquee)
      return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape")
        return;
      e.stopPropagation();
      p.onSelectPaths?.(marqueeRef.current?.base ?? []);
      marqueeRef.current = undefined;
      setMarquee(undefined);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [marquee, p]);

  const items = virtualizer.getVirtualItems();
  const last = items.at(-1);
  const { hasMore, onLoadMore } = p;
  useEffect(() => {
    if (hasMore && last && last.index >= rows - 1)
      onLoadMore();
  }, [hasMore, onLoadMore, last, rows]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", p.roomy && "@container")} role="grid" aria-multiselectable>
      {p.view === "list" && <SortHeader p={p} />}
      <ScrollArea className="min-h-0 flex-1" ref={viewportRef(scrollRef)}>
        <div
          ref={contentRef}
          className={cn("relative flex min-h-full flex-col p-1", p.roomy && p.selection.paths.size > 0 && "pb-14")}
          onClick={() => {
          // The click that ends a marquee keeps its selection.
            if (!draggedRef.current)
              p.onClearSelection();
            draggedRef.current = false;
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endMarquee}
          onPointerCancel={endMarquee}
        >
          {marquee?.active && (
            <div
              data-fm-marquee=""
              className="pointer-events-none absolute z-10 border border-primary bg-primary/10"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
              }}
            />
          )}
          {p.entries.length === 0
            ? <div className="flex flex-1 *:flex-1">{p.empty}</div>
            : (
                <div
                  className="relative w-full"
                  style={{
                    height: virtualizer.getTotalSize(),
                  }}
                >
                  {p.view === "list"
                    ? items.map(row => <ListRow key={p.entries[row.index]!.path} p={p} entry={p.entries[row.index]!} top={row.start} />)
                    : items.map(row => (
                        <div
                          key={row.index}
                          className="absolute inset-x-0 grid"
                          style={{ transform: `translateY(${row.start}px)`, height: tileH, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                        >
                          {p.entries.slice(row.index * cols, row.index * cols + cols).map(e => <GridCell key={e.path} p={p} entry={e} />)}
                        </div>
                      ))}
                </div>
              )}
        </div>
      </ScrollArea>
    </div>
  );
}
