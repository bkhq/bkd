import type { ReactNode } from "react";
import type { FmEntry, FmSortKey } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmFileAction } from "./plugins";
import type { FmController } from "./use-file-manager";
import { cn } from "cn";
import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FolderUpIcon,
  LayoutGridIcon,
  ListIcon,
  PencilIcon,
  ScissorsIcon,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { DetailsPanel } from "./details-panel";
import { IconButton } from "./icon-button";
import { PathBar } from "./path-bar";
import { EMPTY_SELECTION } from "./state";
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

/** Path of the current folder: each step opens a picker of its folder. `root` replaces the mount step. The trash keeps plain crumbs. */
export function ShellBreadcrumb({ fm, root, className }: PartProps & { root?: ReactNode | undefined; className?: string | undefined }) {
  const { client, path, inTrash, mount, currentMount, shownMounts, filter, navigate, open, labels } = fm;
  if (!inTrash || !mount) {
    return (
      <PathBar
        client={client}
        mounts={shownMounts ?? []}
        mount={mount ?? ""}
        path={path}
        labels={labels}
        filter={filter}
        root={root}
        className={className}
        onOpenFile={open}
        onOpenFolder={open}
      />
    );
  }
  return (
    <Breadcrumb className={cn("min-w-0 flex-1 px-1", className)}>
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        <BreadcrumbItem>
          {root ?? <BreadcrumbLink render={<button type="button" onClick={() => navigate(mount, "/")} />}>{currentMount?.label}</BreadcrumbLink>}
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{labels.trash}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** `children` sit after the input. The scope menu leads the input; a clear button ends it while there is a query. */
export function ShellSearch({ fm, width, children }: PartProps & { width: string; children?: ReactNode }) {
  const { narrow, query, changeQuery, searchScope, setSearchScope, labels } = fm;
  const scopeLabel = (s: typeof searchScope) => s === "folder"
    ? labels.searchHere
    : labels.searchBelow;
  return (
    <div className={cn("flex items-center gap-1", narrow && "order-last basis-full")}>
      <InputGroup className={cn("h-7", narrow
        ? "w-full"
        : width)}
      >
        <InputGroupAddon className="py-0">
          <DropdownMenu>
            <DropdownMenuTrigger render={<InputGroupButton size="xs" variant="secondary" className="h-5 px-1.5 text-xs" />}>
              {scopeLabel(searchScope)}
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto min-w-0">
              {(["folder", "below"] as const).map(s => <DropdownMenuItem key={s} className="text-xs" onClick={() => setSearchScope(s)}>{scopeLabel(s)}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label={labels.search}
          placeholder={labels.searchPlaceholder}
          className="h-full text-xs md:text-xs [&::-webkit-search-cancel-button]:appearance-none"
          value={query}
          onChange={e => changeQuery(e.target.value)}
          onKeyDown={e => e.key === "Escape" && changeQuery("")}
        />
        {query && (
          <InputGroupAddon align="inline-end" className="py-0">
            <InputGroupButton size="icon-xs" aria-label={labels.clearSearch} title={labels.clearSearch} onClick={() => changeQuery("")}>
              <XIcon />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {children}
    </div>
  );
}

/** Buttons acting on the selection; `actions` come before delete. */
export function SelectionActions({ fm, actions = [] }: PartProps & { actions?: FmFileAction[] | undefined }) {
  const { selected, features, labels, download, copyToClipboard, setDialog, runAction, requestDelete } = fm;
  return (
    <>
      {features.download && <IconButton label={labels.download} onClick={() => download(selected)}><DownloadIcon /></IconButton>}
      {selected.every(s => s.caps.copy) && <IconButton label={labels.copy} onClick={() => copyToClipboard("copy", selected)}><CopyIcon /></IconButton>}
      {selected.every(s => s.caps.move) && <IconButton label={labels.cut} onClick={() => copyToClipboard("cut", selected)}><ScissorsIcon /></IconButton>}
      {selected.length === 1 && selected[0]!.caps.rename && <IconButton label={labels.rename} onClick={() => setDialog({ kind: "rename", entry: selected[0]! })}><PencilIcon /></IconButton>}
      {actions.map(a => <IconButton key={a.id} label={a.label} onClick={() => runAction(a, selected)}>{a.icon}</IconButton>)}
      {selected.every(s => s.caps.delete) && <IconButton label={labels.delete} className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => requestDelete(selected.map(s => s.path))}><Trash2Icon /></IconButton>}
    </>
  );
}

/** Bulk actions floating at the bottom centre of the listing, above the undo notice. */
export function FloatingSelectionBar({ fm, actions }: PartProps & { actions?: FmFileAction[] | undefined }) {
  const { selected, notice, setRawSelection, labels } = fm;
  return (
    <div
      className={cn("absolute left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] w-max -translate-x-1/2 flex-wrap items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg", notice
        ? "bottom-14"
        : "bottom-3")}
      role="toolbar"
      aria-label={labels.selected(selected.length)}
    >
      <IconButton label={labels.cancel} onClick={() => setRawSelection(EMPTY_SELECTION)}><XIcon /></IconButton>
      <span className="px-1 text-sm whitespace-nowrap">{labels.selected(selected.length)}</span>
      <SelectionActions fm={fm} actions={actions} />
    </div>
  );
}
