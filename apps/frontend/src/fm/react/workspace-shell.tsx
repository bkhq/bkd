import type { FmSortKey } from "../core/schema";
import type { FileManagerProps } from "./file-manager";
import type { FmController } from "./use-file-manager";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ClipboardPasteIcon,
  CopyIcon,
  DownloadIcon,
  FilePlusIcon,
  FileSearchIcon,
  FilterIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderUpIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  PanelLeftIcon,
  PencilIcon,
  RefreshCwIcon,
  ScissorsIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
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
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { fmKeys } from "../client/hooks";
import { basename, dirname } from "../core/path";
import { DetailsPanel } from "./details-panel";
import { EntryIcon } from "./file-list";
import { FilterChips, FilterMenuItems } from "./filter-menu";
import { hasFilters } from "./filters";
import { IconButton } from "./icon-button";
import { ManagerList } from "./manager-list";
import { MenuScroll } from "./menu-scroll";
import { groupMountsByDriver } from "./mount-visibility";
import { PathBar } from "./path-bar";
import { PreviewBody } from "./preview-pane";
import { ReviewView } from "./review-dialog";
import { EMPTY_SELECTION, formatSize } from "./state";
import { TrashView } from "./trash-view";
import { WorkspaceTreePane } from "./workspace-tree-pane";

export function WorkspaceShell({ props, fm }: { props: FileManagerProps; fm: FmController }) {
  const {
    client,
    query,
    searchScope,
    setSearchScope,
    view,
    setView,
    setLayout,
    setNarrowPane,
    sort,
    setSort,
    setRawSelection,
    setDialog,
    setQuickOpen,
    setError,
    setNotice,
    detailsOpen,
    setDetailsOpen,
    paneActions,
    setPaneActions,
    path,
    inTrash,
    labels,
    qc,
    pluginPreviewers,
    features,
    storageKey,
    mount,
    shownMounts,
    canManageDrives,
    filter,
    narrow,
    stacked,
    split,
    treeOnly,
    paneDirtyRef,
    guard,
    fileInputRef,
    folderInputRef,
    pick,
    listing,
    below,
    search,
    filters,
    changeFilters,
    entries,
    dir,
    selected,
    explorer,
    paneFile,
    review,
    reviewer,
    changeMounts,
    changeQueries,
    changeEntries,
    treeSections,
    canUpload,
    canMkdir,
    canNewFile,
    shownError,
    currentMount,
    trashItems,
    go,
    navigate,
    changeQuery,
    requestDelete,
    reveal,
    pickQuickOpen,
    canQuickOpen,
    download,
    copyToClipboard,
    canPaste,
    paste,
    pickFiles,
    onKeyDown,
    dropzone,
    menuContent,
    blankMenu,
    columns,
    columnValues,
  } = fm;
  const uploadMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IconButton label={labels.upload} />}><UploadIcon /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => pickFiles(fileInputRef.current)}>
          <UploadIcon />
          {labels.upload}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => pickFiles(folderInputRef.current)}>
          <FolderUpIcon />
          {labels.uploadFolder}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const refreshButton = (
    <IconButton
      label={labels.refresh}
      onClick={() => void qc.invalidateQueries({
        queryKey: fmKeys.all(client),
      })}
    >
      <RefreshCwIcon />
    </IconButton>
  );

  const crumbs = path === "/"
    ? []
    : path.slice(1).split("/");

  const detailsEntry = detailsOpen && features.details && !inTrash
    ? (selected.length === 1
        ? selected[0]
        : dir)
    : undefined;
  const sideDetails = !!detailsEntry && !narrow;
  const panes = useDefaultLayout({
    id: `${storageKey}:panels`,
    panelIds: [
      ...(split && !stacked
        ? ["tree"]
        : []),
      "main",
      ...(sideDetails
        ? ["details"]
        : []),
    ],
    ...(typeof localStorage !== "undefined"
      ? { storage: localStorage }
      : {}),
  });

  // Tree toolbar and folder tree; a side panel, or a full-size view on narrow containers.

  return (
    <>
      <ResizablePanelGroup id={`${storageKey}:panels`} orientation="horizontal" className="min-w-0 flex-1" defaultLayout={panes.defaultLayout} onLayoutChanged={panes.onLayoutChanged}>
        {split && !stacked && (
          <ResizablePanel id="tree" defaultSize="224px" minSize="160px" maxSize="40%" className="flex flex-col">
            <WorkspaceTreePane props={props} fm={fm} />
          </ResizablePanel>
        )}
        {split && !stacked && <ResizableHandle withHandle aria-label={labels.resizeTree} />}

        <ResizablePanel id="main" minSize="320px">

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
            <header className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
              {stacked && (
                <IconButton label={labels.backToTree} onClick={() => guard(() => setNarrowPane("tree"))}>
                  <ArrowLeftIcon />
                </IconButton>
              )}
              {explorer && !inTrash && mount && shownMounts
                ? (
                    <PathBar
                      client={client}
                      mounts={shownMounts}
                      mount={mount}
                      path={path}
                      file={paneFile}
                      labels={labels}
                      filter={filter}
                      onOpenFile={reveal}
                    />
                  )
                : (
                    <>
                      <IconButton label={labels.up} disabled={path === "/"} onClick={() => mount && navigate(mount, dirname(path))}>
                        <ArrowUpIcon />
                      </IconButton>
                      {/* Narrow: the toolbar wraps below the breadcrumb instead of squeezing it. */}
                      <Breadcrumb className={cn("min-w-0 flex-1 px-1", narrow && "basis-[calc(100%-2.5rem)]")}>
                        <BreadcrumbList className="flex-nowrap overflow-hidden">
                          <BreadcrumbItem>
                            {!split && shownMounts
                              ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger render={<button type="button" className="flex items-center gap-1 rounded-sm hover:text-foreground" aria-label={labels.storage} />}>
                                      <span className="truncate">{currentMount?.label}</span>
                                      <ChevronDownIcon className="size-3.5" />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="w-56">
                                      <DropdownMenuRadioGroup
                                        value={inTrash
                                          ? ""
                                          : mount ?? ""}
                                        onValueChange={v => navigate(v as string, "/")}
                                      >
                                        {props.sidebar?.group === "driver"
                                          ? groupMountsByDriver(shownMounts).map(g => (
                                              <DropdownMenuGroup key={g.driver}>
                                                <DropdownMenuLabel>{labels.driverGroup(g.driver)}</DropdownMenuLabel>
                                                {g.mounts.map(m => <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>{m.label}</DropdownMenuRadioItem>)}
                                              </DropdownMenuGroup>
                                            ))
                                          : shownMounts.map(m => <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>{m.label}</DropdownMenuRadioItem>)}
                                      </DropdownMenuRadioGroup>
                                      {treeSections.map(sec => (
                                        <DropdownMenuSub key={sec.id}>
                                          <DropdownMenuSubTrigger>
                                            {sec.icon}
                                            {sec.label}
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent className="w-64 overflow-hidden p-0">
                                            <MenuScroll>
                                              {sec.entries.map(e => (
                                                <DropdownMenuItem key={`${e.mount}:${e.path}`} title={`${e.mount}:${e.path}`} onClick={() => pickQuickOpen(e)}>
                                                  <EntryIcon entry={e} />
                                                  <span className="truncate">{e.name}</span>
                                                </DropdownMenuItem>
                                              ))}
                                            </MenuScroll>
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                      ))}
                                      {treeSections.length > 0 && <DropdownMenuSeparator />}
                                      {currentMount?.trash && features.trash && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem onClick={() => go(currentMount.id, "/", true)}>
                                            <Trash2Icon />
                                            {labels.trash}
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                      {canManageDrives && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem onClick={() => setDialog({ kind: "manageDrives" })}>
                                            <SettingsIcon />
                                            {labels.manageDrives}
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )
                              : crumbs.length || inTrash
                                ? <BreadcrumbLink render={<button type="button" onClick={() => mount && navigate(mount, "/")} />}>{currentMount?.label}</BreadcrumbLink>
                                : <BreadcrumbPage>{currentMount?.label}</BreadcrumbPage>}
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
                    </>
                  )}

              {inTrash
                ? (
                    <Button size="sm" variant="ghost" disabled={trashItems.length === 0} onClick={() => setDialog({ kind: "emptyTrash" })}>
                      <Trash2Icon />
                      {labels.emptyTrash}
                    </Button>
                  )
                : features.search && !explorer && (
                  <div className={cn("relative flex items-center gap-1", narrow && "order-last basis-full")}>
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="search"
                      aria-label={labels.search}
                      placeholder={labels.search}
                      className={cn("h-7 pl-7 text-xs md:text-xs", narrow
                        ? "w-full"
                        : "w-48")}
                      value={query}
                      onChange={e => changeQuery(e.target.value)}
                      onKeyDown={e => e.key === "Escape" && changeQuery("")}
                    />
                    {canQuickOpen && <IconButton label={labels.quickOpen} onClick={() => setQuickOpen(true)}><FileSearchIcon /></IconButton>}
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
                )}

              {inTrash
                ? null
                : explorer
                  ? (review || paneFile) && (
                      <div className="flex items-center gap-1" role="toolbar" aria-label={review ? labels.changes : paneFile!.name}>
                        <div ref={setPaneActions} className="flex items-center gap-1" />
                      </div>
                    )
                  : selected.length > 0
                    ? (
                        <div className="flex items-center gap-1" role="toolbar" aria-label={labels.selected(selected.length)}>
                          <span className="px-2 text-xs text-muted-foreground">{labels.selected(selected.length)}</span>
                          {features.download && <IconButton label={labels.download} onClick={() => download(selected)}><DownloadIcon /></IconButton>}
                          {selected.every(s => s.caps.copy) && <IconButton label={labels.copy} onClick={() => copyToClipboard("copy", selected)}><CopyIcon /></IconButton>}
                          {selected.every(s => s.caps.move) && <IconButton label={labels.cut} onClick={() => copyToClipboard("cut", selected)}><ScissorsIcon /></IconButton>}
                          {selected.length === 1 && selected[0]!.caps.rename && <IconButton label={labels.rename} onClick={() => setDialog({ kind: "rename", entry: selected[0]! })}><PencilIcon /></IconButton>}
                          {selected.every(s => s.caps.delete) && (
                            <IconButton
                              label={labels.delete}
                              onClick={() => requestDelete(selected.map(s => s.path))}
                            >
                              <Trash2Icon />
                            </IconButton>
                          )}
                          <IconButton label={labels.cancel} onClick={() => setRawSelection(EMPTY_SELECTION)}><XIcon /></IconButton>
                        </div>
                      )
                    : (
                        <div className="flex items-center gap-1" role="toolbar">
                          {canPaste && (
                            <Button size="sm" variant="ghost" onClick={paste}>
                              <ClipboardPasteIcon />
                              {labels.paste}
                            </Button>
                          )}
                          {canMkdir && <IconButton label={labels.newFolder} onClick={() => setDialog({ kind: "mkdir" })}><FolderPlusIcon /></IconButton>}
                          {canNewFile && <IconButton label={labels.newFile} onClick={() => setDialog({ kind: "newFile" })}><FilePlusIcon /></IconButton>}
                          {canUpload && uploadMenu}
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<IconButton label={labels.filter} aria-pressed={hasFilters(filters)} />}><FilterIcon /></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <FilterMenuItems filters={filters} onChange={changeFilters} labels={labels} columns={columns} values={columnValues} />
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <DropdownMenu>
                            {narrow
                              ? <DropdownMenuTrigger render={<IconButton label={labels.sortBy} />}><ArrowUpDownIcon /></DropdownMenuTrigger>
                              : <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>{labels.sortBy}</DropdownMenuTrigger>}
                            <DropdownMenuContent align="end" className="w-40">
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
                            </DropdownMenuContent>
                          </DropdownMenu>
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
                          {refreshButton}
                        </div>
                      )}
              {!narrow && (
                <IconButton label={split ? labels.hideSidebar : labels.showSidebar} aria-pressed={split} onClick={() => setLayout(split ? "single" : "split")}>
                  <PanelLeftIcon />
                </IconButton>
              )}
              {!inTrash && features.details && (
                <IconButton label={labels.details} aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
                  <InfoIcon />
                </IconButton>
              )}
            </header>

            {!explorer && !inTrash && <FilterChips filters={filters} onChange={changeFilters} labels={labels} columns={columns} />}

            {shownError && (
              <div role="alert" className="flex items-center gap-2 border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                <span className="flex-1">{shownError}</span>
                <IconButton size="icon-xs" label={labels.close} onClick={() => setError(undefined)}><XIcon /></IconButton>
              </div>
            )}

            {below && search.data?.truncated && (
              <div className="border-b px-3 py-1 text-xs text-muted-foreground">{labels.searchTruncated}</div>
            )}

            {inTrash && mount
              ? (
                  <TrashView
                    mount={mount}
                    mountLabel={currentMount?.label ?? mount}
                    retentionDays={currentMount?.trashRetentionDays}
                    client={client}
                    labels={labels}
                    onError={setError}
                    onRestored={n => n > 0 && setNotice({ message: labels.restored })}
                  />
                )
              : explorer
                ? (review && reviewer
                    ? (
                        <div className="min-h-0 flex-1" data-fm-review="">
                          <ReviewView
                            reviewer={reviewer}
                            client={client}
                            mount={review.mount}
                            labels={labels}
                            changes={changeQueries[changeMounts.indexOf(review.mount)]?.data ?? []}
                            path={review.path}
                            actions={paneActions}
                            onOpenFile={p => reveal({
                              ...changeEntries.find(e => e.mount === review.mount && e.path === p)!,
                              path: p,
                            })}
                          />
                        </div>
                      )
                    : paneFile
                      ? (
                          <div className="min-h-0 flex-1">
                            <PreviewBody
                              entry={paneFile}
                              client={client}
                              labels={labels}
                              editable={features.edit}
                              previewers={pluginPreviewers}
                              actions={paneActions}
                              onDirtyChange={(d) => {
                                paneDirtyRef.current = d;
                              }}
                            />
                          </div>
                        )
                      : (
                          <ContextMenu>
                            <ContextMenuTrigger render={<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center" />}>
                              <FolderOpenIcon className="size-10 text-muted-foreground/60" />
                              <div className="font-medium">
                                {path === "/"
                                  ? currentMount?.label
                                  : basename(path)}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {listing.isPending
                                  ? labels.loading
                                  : labels.folderItems(entries.length, !!listing.hasNextPage)}
                              </div>
                              <div className="text-sm text-muted-foreground">{labels.selectFileHint}</div>
                              {canUpload && (
                                <button
                                  type="button"
                                  className="mt-2 flex flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-4 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                                  onClick={() => pickFiles(fileInputRef.current)}
                                >
                                  <UploadIcon className="size-4" />
                                  {labels.dropOrClick}
                                </button>
                              )}
                            </ContextMenuTrigger>
                            {menuContent(blankMenu())}
                          </ContextMenu>
                        ))
                : (
                    <ManagerList fm={fm} />
                  )}

            {dropzone.isDragActive && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/5 ring-2 ring-primary ring-inset">
                <span className="rounded-md bg-background px-3 py-1.5 text-sm shadow">{labels.dropHere}</span>
              </div>
            )}

            {pick && (() => {
              const total = selected.reduce((n, e) => n + e.size, 0);
              const over = pick.maxTotalSize !== undefined && total > pick.maxTotalSize;
              return (
                <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-sm" data-fm-pick-bar="">
                  <span>{labels.selected(selected.length)}</span>
                  <span className="text-muted-foreground tabular-nums">{labels.pickTotal(formatSize(total))}</span>
                  {over && <span role="alert" className="text-destructive">{labels.pickOverLimit(formatSize(pick.maxTotalSize!))}</span>}
                  <span className="flex-1" />
                  {pick.onCancel && <Button size="sm" variant="ghost" onClick={pick.onCancel}>{labels.cancel}</Button>}
                  <Button size="sm" disabled={selected.length === 0 || over} onClick={() => pick.onPick(selected)}>{labels.confirm}</Button>
                </footer>
              );
            })()}
          </section>
        </ResizablePanel>

        {sideDetails && detailsEntry && <ResizableHandle withHandle aria-label={labels.resizeDetails} />}
        {sideDetails && detailsEntry && (
          <ResizablePanel id="details" defaultSize="288px" minSize="220px" maxSize="50%">
            <DetailsPanel
              key={detailsEntry.path}
              entry={detailsEntry}
              mountLabel={currentMount?.label ?? ""}
              client={client}
              labels={labels}
              overlay={false}
              columns={props.columns}
              tabs={props.detailTabs}
              onClose={() => setDetailsOpen(false)}
            />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      {treeOnly && <div className="absolute inset-0 z-10 flex flex-col bg-background"><WorkspaceTreePane props={props} fm={fm} /></div>}

      {detailsEntry && narrow && (
        <DetailsPanel
          key={detailsEntry.path}
          entry={detailsEntry}
          mountLabel={currentMount?.label ?? ""}
          client={client}
          labels={labels}
          overlay
          columns={props.columns}
          tabs={props.detailTabs}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </>
  );
}
