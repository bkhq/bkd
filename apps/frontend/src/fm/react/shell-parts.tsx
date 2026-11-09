import type { ReactNode } from "react";
import type { FmEntry, FmSortKey } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmFileAction } from "./plugins";
import type { FmController } from "./use-file-manager";
import { cn } from "cn";
import {
  CopyIcon,
  DownloadIcon,
  FolderUpIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  ScissorsIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
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
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DetailsPanel } from "./details-panel";
import { IconButton } from "./icon-button";
import { TrashView } from "./trash-view";

interface PartProps {
  fm: FmController;
}

/** The main column: drop target, keyboard handling and the drop overlay. */
export function ShellDropSection({ fm, children }: PartProps & { children: ReactNode }) {
  const { dropzone, treeOnly, currentMount, onKeyDown, labels } = fm;
  return (
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
      {children}
      {dropzone.isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 ring-2 ring-primary ring-inset">
          <span className="rounded-md bg-background px-3 py-1.5 text-sm shadow">{labels.dropHere}</span>
        </div>
      )}
    </section>
  );
}

export function ShellNotices({ fm }: PartProps) {
  const { shownError, setError, below, search, labels } = fm;
  return (
    <>
      {shownError && (
        <div role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <span className="flex-1">{shownError}</span>
          <IconButton size="icon-xs" label={labels.close} onClick={() => setError(undefined)}><XIcon /></IconButton>
        </div>
      )}
      {below && search.data?.truncated && (
        <div className="border-b px-3 py-1 text-xs text-muted-foreground">{labels.searchTruncated}</div>
      )}
    </>
  );
}

export function ShellTrash({ fm, mount }: PartProps & { mount: string }) {
  const { currentMount, client, labels, setError, setNotice } = fm;
  return (
    <TrashView
      mount={mount}
      mountLabel={currentMount?.label ?? mount}
      retentionDays={currentMount?.trashRetentionDays}
      client={client}
      labels={labels}
      onError={setError}
      onRestored={n => n > 0 && setNotice({ message: labels.restored })}
    />
  );
}

export function ShellDetails({ fm, props, entry, overlay }: PartProps & { props: FileManagerProps; entry: FmEntry; overlay: boolean }) {
  const { currentMount, client, labels, setDetailsOpen } = fm;
  return (
    <DetailsPanel
      key={entry.path}
      entry={entry}
      mountLabel={currentMount?.label ?? ""}
      absoluteRoot={currentMount?.absoluteRoot}
      client={client}
      labels={labels}
      overlay={overlay}
      columns={props.columns}
      tabs={props.detailTabs}
      onClose={() => setDetailsOpen(false)}
    />
  );
}

export function ViewToggle({ fm }: PartProps) {
  const { view, setView, labels } = fm;
  return (
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
  );
}

export function EmptyTrashButton({ fm }: PartProps) {
  const { trashItems, setDialog, labels } = fm;
  return (
    <Button size="sm" variant="ghost" disabled={trashItems.length === 0} onClick={() => setDialog({ kind: "emptyTrash" })}>
      <Trash2Icon />
      {labels.emptyTrash}
    </Button>
  );
}

export function SortMenuItems({ fm }: PartProps) {
  const { sort, setSort, labels } = fm;
  return (
    <>
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
    </>
  );
}

export function UploadMenuItems({ fm }: PartProps) {
  const { pickFiles, fileInputRef, folderInputRef, labels } = fm;
  return (
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
  );
}

/** `root` replaces the link or page of the first crumb. */
export function ShellBreadcrumb({ fm, root, className }: PartProps & { root?: ReactNode | undefined; className?: string | undefined }) {
  const { path, inTrash, mount, currentMount, navigate, labels } = fm;
  const crumbs = path === "/"
    ? []
    : path.slice(1).split("/");
  return (
    <Breadcrumb className={cn("min-w-0 flex-1 px-1", className)}>
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        <BreadcrumbItem>
          {root ?? (crumbs.length || inTrash
            ? <BreadcrumbLink render={<button type="button" onClick={() => mount && navigate(mount, "/")} />}>{currentMount?.label}</BreadcrumbLink>
            : <BreadcrumbPage>{currentMount?.label}</BreadcrumbPage>)}
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
  );
}

/** `children` sit between the input and the scope buttons. */
export function ShellSearch({ fm, width, children }: PartProps & { width: string; children?: ReactNode }) {
  const { narrow, query, changeQuery, searchScope, setSearchScope, labels } = fm;
  return (
    <div className={cn("relative flex items-center gap-1", narrow && "order-last basis-full")}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={labels.search}
        placeholder={labels.search}
        className={cn("h-7 pl-7 text-xs md:text-xs", narrow
          ? "w-full"
          : width)}
        value={query}
        onChange={e => changeQuery(e.target.value)}
        onKeyDown={e => e.key === "Escape" && changeQuery("")}
      />
      {children}
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
  );
}

/** Buttons acting on the selection; `actions` come before delete. */
export function SelectionActions({ fm, actions = [] }: PartProps & { actions?: FmFileAction[] }) {
  const { selected, features, labels, download, copyToClipboard, setDialog, runAction, requestDelete } = fm;
  return (
    <>
      {features.download && <IconButton label={labels.download} onClick={() => download(selected)}><DownloadIcon /></IconButton>}
      {selected.every(s => s.caps.copy) && <IconButton label={labels.copy} onClick={() => copyToClipboard("copy", selected)}><CopyIcon /></IconButton>}
      {selected.every(s => s.caps.move) && <IconButton label={labels.cut} onClick={() => copyToClipboard("cut", selected)}><ScissorsIcon /></IconButton>}
      {selected.length === 1 && selected[0]!.caps.rename && <IconButton label={labels.rename} onClick={() => setDialog({ kind: "rename", entry: selected[0]! })}><PencilIcon /></IconButton>}
      {actions.map(a => <IconButton key={a.id} label={a.label} onClick={() => runAction(a, selected)}>{a.icon}</IconButton>)}
      {selected.every(s => s.caps.delete) && <IconButton label={labels.delete} onClick={() => requestDelete(selected.map(s => s.path))}><Trash2Icon /></IconButton>}
    </>
  );
}
