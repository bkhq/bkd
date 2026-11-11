import type { FileManagerProps } from "./file-manager";
import type { FmController } from "./use-file-manager";
import {
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ClipboardPasteIcon,
  EllipsisIcon,
  FilePlusIcon,
  FileSearchIcon,
  FilterIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  InfoIcon,
  LayoutGridIcon,
  ListIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  SettingsIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { fmKeys } from "../client/hooks";
import { basename, dirname } from "../core/path";
import { EntryIcon } from "./file-list";
import { FilterChips, FilterMenuItems } from "./filter-menu";
import { hasFilters } from "./filters";
import { IconButton, RefreshButton } from "./icon-button";
import { ManagerList } from "./manager-list";
import { shellDetailsEntry } from "./manager-shared";
import { MenuScroll } from "./menu-scroll";
import { groupMountsByDriver } from "./mount-visibility";
import { PathBar } from "./path-bar";
import { PreviewBody } from "./preview-pane";
import { ReviewView } from "./review-dialog";
import {
  EmptyTrashButton,
  FloatingSelectionBar,
  SelectionActions,
  ShellBreadcrumb,
  ShellDetails,
  ShellDropSection,
  ShellNotices,
  ShellSearch,
  ShellTrash,
  SortMenuItems,
  UploadMenuItems,
  ViewToggle,
} from "./shell-parts";
import { EMPTY_SELECTION, formatSize } from "./state";
import { WorkspaceTreePane } from "./workspace-tree-pane";

export function WorkspaceShell({ props, fm }: { props: FileManagerProps; fm: FmController }) {
  const {
    client,
    setLayout,
    setNarrowPane,
    setRawSelection,
    setDialog,
    setQuickOpen,
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
    pick,
    listing,
    filters,
    changeFilters,
    entries,
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
    currentMount,
    go,
    navigate,
    reveal,
    pickQuickOpen,
    canQuickOpen,
    canPaste,
    paste,
    pickFiles,
    menuContent,
    blankMenu,
    columns,
    columnValues,
    view,
    setView,
  } = fm;
  // Without the sidebar the listing takes the drive look.
  const roomy = !split && !pick;
  const uploadMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IconButton label={labels.upload} />}><UploadIcon /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <UploadMenuItems fm={fm} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const refreshButton = (
    <RefreshButton
      label={labels.refresh}
      onRefresh={() => qc.invalidateQueries({
        queryKey: fmKeys.all(client),
      })}
    />
  );

  const detailsEntry = shellDetailsEntry(fm);
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

  // Narrow containers fold the folder toolbar into one "More" menu so it shares the path row.
  const folded = narrow && !inTrash && !explorer && !(selected.length > 0 && !roomy);

  // Host controls go in the bar at the manager's top-right corner: the explorer row while a
  // narrow manager shows only the tree, the main header otherwise. Never in pick mode.
  const hostActions = props.headerActions != null && !pick
    ? <div className="ml-auto flex shrink-0 items-center gap-0.5">{props.headerActions}</div>
    : undefined;

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

          <ShellDropSection fm={fm}>
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
                      <ShellBreadcrumb
                        fm={fm}
                        className={narrow && !folded
                          ? "basis-[calc(100%-2.5rem)]"
                          : undefined}
                        root={!split && shownMounts
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
                                  {treeSections.length > 0 && <DropdownMenuSeparator />}
                                  {treeSections.map(sec => (
                                    <DropdownMenuSub key={sec.id}>
                                      {/* Muted tree icons take the menu colour here; accent colours stay. */}
                                      <DropdownMenuSubTrigger className="[&_svg.text-muted-foreground]:text-current">
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
                          : undefined}
                      />
                    </>
                  )}

              {inTrash
                ? (
                    <EmptyTrashButton fm={fm} />
                  )
                : features.search && !explorer && (
                  <ShellSearch fm={fm} width="w-64">
                    {canQuickOpen && <IconButton label={labels.quickOpen} onClick={() => setQuickOpen(true)}><FileSearchIcon /></IconButton>}
                  </ShellSearch>
                )}

              {inTrash
                ? null
                : explorer
                  ? (review || paneFile) && (
                      <div className="flex items-center gap-1" role="toolbar" aria-label={review ? labels.changes : paneFile!.name}>
                        <div ref={setPaneActions} className="flex items-center gap-1" />
                      </div>
                    )
                  : selected.length > 0 && !roomy
                    ? (
                        <div className="flex items-center gap-1" role="toolbar" aria-label={labels.selected(selected.length)}>
                          <span className="px-2 text-xs text-muted-foreground">{labels.selected(selected.length)}</span>
                          <SelectionActions fm={fm} />
                          <IconButton label={labels.cancel} onClick={() => setRawSelection(EMPTY_SELECTION)}><XIcon /></IconButton>
                        </div>
                      )
                    : folded
                      ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<IconButton label={labels.more} aria-pressed={hasFilters(filters)} />}><EllipsisIcon /></DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              {canPaste && (
                                <DropdownMenuItem onClick={paste}>
                                  <ClipboardPasteIcon />
                                  {labels.paste}
                                </DropdownMenuItem>
                              )}
                              {canMkdir && (
                                <DropdownMenuItem onClick={() => setDialog({ kind: "mkdir" })}>
                                  <FolderPlusIcon />
                                  {labels.newFolder}
                                </DropdownMenuItem>
                              )}
                              {canNewFile && (
                                <DropdownMenuItem onClick={() => setDialog({ kind: "newFile" })}>
                                  <FilePlusIcon />
                                  {labels.newFile}
                                </DropdownMenuItem>
                              )}
                              {canUpload && <UploadMenuItems fm={fm} />}
                              {(canPaste || canMkdir || canNewFile || canUpload) && <DropdownMenuSeparator />}
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <FilterIcon />
                                  {labels.filter}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-48">
                                  <FilterMenuItems filters={filters} onChange={changeFilters} labels={labels} columns={columns} values={columnValues} />
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <ArrowUpDownIcon />
                                  {labels.sortBy}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-40">
                                  <SortMenuItems fm={fm} />
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                              <DropdownMenuItem onClick={() => setView(view === "list"
                                ? "grid"
                                : "list")}
                              >
                                {view === "list"
                                  ? <LayoutGridIcon />
                                  : <ListIcon />}
                                {view === "list"
                                  ? labels.gridView
                                  : labels.listView}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void qc.invalidateQueries({
                                queryKey: fmKeys.all(client),
                              })}
                              >
                                <RefreshCwIcon />
                                {labels.refresh}
                              </DropdownMenuItem>
                              {features.details && (
                                <DropdownMenuCheckboxItem closeOnClick checked={detailsOpen} onCheckedChange={setDetailsOpen}>
                                  {labels.details}
                                </DropdownMenuCheckboxItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
                              <DropdownMenuTrigger render={<IconButton label={labels.sortBy} />}><ArrowUpDownIcon /></DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <SortMenuItems fm={fm} />
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <ViewToggle fm={fm} />
                            {refreshButton}
                          </div>
                        )}
              {!narrow && (
                <IconButton label={split ? labels.hideSidebar : labels.showSidebar} aria-pressed={split} onClick={() => setLayout(split ? "single" : "split")}>
                  <PanelLeftIcon />
                </IconButton>
              )}
              {!inTrash && !folded && features.details && (
                <IconButton label={labels.details} aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
                  <InfoIcon />
                </IconButton>
              )}
              {!treeOnly && hostActions}
            </header>

            {!explorer && !inTrash && <FilterChips filters={filters} onChange={changeFilters} labels={labels} columns={columns} />}

            <ShellNotices fm={fm} />

            {inTrash && mount
              ? (
                  <ShellTrash fm={fm} mount={mount} />
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
                    <ManagerList fm={fm} roomy={roomy} />
                  )}

            {roomy && !explorer && !inTrash && selected.length > 0 && <FloatingSelectionBar fm={fm} />}

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
          </ShellDropSection>
        </ResizablePanel>

        {sideDetails && detailsEntry && <ResizableHandle withHandle aria-label={labels.resizeDetails} />}
        {sideDetails && detailsEntry && (
          <ResizablePanel id="details" defaultSize="288px" minSize="220px" maxSize="50%">
            <ShellDetails fm={fm} props={props} entry={detailsEntry} overlay={false} />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>

      {treeOnly && <div className="absolute inset-0 z-10 flex flex-col bg-background"><WorkspaceTreePane props={props} fm={fm} actions={hostActions} /></div>}

      {detailsEntry && narrow && (
        <ShellDetails fm={fm} props={props} entry={detailsEntry} overlay />
      )}
    </>
  );
}
