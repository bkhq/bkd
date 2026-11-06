import type { FileManagerProps } from "./file-manager";
import type { FmController } from "./use-file-manager";
import {
  ChevronsDownUpIcon,
  ClipboardPasteIcon,
  EllipsisIcon,
  FilePlusIcon,
  FileSearchIcon,
  FilterIcon,
  FolderPlusIcon,
  FolderUpIcon,
  GitCompareIcon,
  RefreshCwIcon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmKeys } from "../client/hooks";
import { FilterChips, FilterMenuItems } from "./filter-menu";
import { IconButton } from "./icon-button";
import { onPathKeys } from "./manager-shared";
import { ManagerTree } from "./manager-tree";

/** Explorer header and folder tree of the workspace shell. */
export function WorkspaceTreePane({ props, fm }: { props: FileManagerProps; fm: FmController }) {
  const {
    client,
    setExpanded,
    setHiddenFiles,
    setIgnoredFiles,
    setDialog,
    setQuickOpen,
    path,
    inTrash,
    labels,
    qc,
    mount,
    collapseAll,
    showHidden,
    showIgnored,
    fileInputRef,
    folderInputRef,
    filters,
    changeFilters,
    hasIgnored,
    selected,
    explorer,
    showStarred,
    setShowStarred,
    showRecent,
    setShowRecent,
    setReview,
    meta,
    reviewer,
    changeIndex,
    changeEntries,
    canUpload,
    canMkdir,
    canNewFile,
    canQuickOpen,
    canPaste,
    paste,
    pickFiles,
    columns,
    columnValues,
  } = fm;
  // Explorer refresh also reveals the selected row (or the current folder) like VS Code:
  // its ancestors open and the tree scrolls the row into view once it is loaded.
  const [revealTick, setRevealTick] = useState(0);
  const refreshTree = () => {
    void qc.invalidateQueries({
      queryKey: fmKeys.all(client),
    });
    if (!mount)
      return;
    const target = selected.length === 1
      ? selected[0]!.path
      : path;
    setExpanded(s => new Set([
      ...s,
      ...onPathKeys(mount, target, inTrash),
    ]));
    setRevealTick(t => t + 1);
  };
  return (
    <>
      {explorer && (
        // VS Code style: title on the left, common actions, the rest under "More". With a mouse the
        // actions appear on hover and take no room otherwise, so the title is not cut short; touch
        // screens, which cannot hover, always show them.
        <div className="group/explorer flex h-9 shrink-0 items-center gap-0.5 pr-1 pl-3">
          <span className="flex-1 truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{labels.explorer}</span>
          <div
            role="toolbar"
            aria-label={labels.folderActions}
            className="flex items-center gap-0.5 pointer-fine:w-0 pointer-fine:overflow-hidden pointer-fine:opacity-0 group-hover/explorer:w-auto group-hover/explorer:overflow-visible group-hover/explorer:opacity-100 focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100 has-aria-expanded:w-auto has-aria-expanded:overflow-visible has-aria-expanded:opacity-100"
          >
            {canNewFile && <IconButton label={labels.newFile} onClick={() => setDialog({ kind: "newFile" })}><FilePlusIcon /></IconButton>}
            {canMkdir && <IconButton label={labels.newFolder} onClick={() => setDialog({ kind: "mkdir" })}><FolderPlusIcon /></IconButton>}
            <IconButton label={labels.refresh} onClick={refreshTree}><RefreshCwIcon /></IconButton>
            <IconButton label={labels.collapseAll} onClick={collapseAll}><ChevronsDownUpIcon /></IconButton>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<IconButton label={labels.more} />}><EllipsisIcon /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {canUpload && (
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
              )}
              {canPaste && (
                <DropdownMenuItem onClick={paste}>
                  <ClipboardPasteIcon />
                  {labels.paste}
                </DropdownMenuItem>
              )}
              {canQuickOpen && (
                <DropdownMenuItem onClick={() => setQuickOpen(true)}>
                  <FileSearchIcon />
                  {labels.quickOpen}
                </DropdownMenuItem>
              )}
              {(canUpload || canPaste || canQuickOpen) && <DropdownMenuSeparator />}
              {reviewer && changeEntries.length > 0 && mount && (
                <DropdownMenuItem onClick={() => setReview({
                  mount: changeIndex.get(mount)?.byPath.size
                    ? mount
                    : changeEntries[0]!.mount,
                })}
                >
                  <GitCompareIcon />
                  {labels.reviewAll}
                </DropdownMenuItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FilterIcon />
                  {labels.filter}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <FilterMenuItems filters={filters} onChange={changeFilters} labels={labels} columns={columns} values={columnValues} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuCheckboxItem closeOnClick checked={showHidden} onCheckedChange={on => setHiddenFiles(on ? "on" : "off")}>
                {labels.showHiddenFiles}
              </DropdownMenuCheckboxItem>
              {meta?.starred && (
                <DropdownMenuCheckboxItem closeOnClick checked={showStarred === "on"} onCheckedChange={on => setShowStarred(on ? "on" : "off")}>
                  {labels.showStarred}
                </DropdownMenuCheckboxItem>
              )}
              {meta?.recent && (
                <DropdownMenuCheckboxItem closeOnClick checked={showRecent === "on"} onCheckedChange={on => setShowRecent(on ? "on" : "off")}>
                  {labels.showRecent}
                </DropdownMenuCheckboxItem>
              )}
              {(hasIgnored || !showIgnored) && (
                <DropdownMenuCheckboxItem closeOnClick checked={showIgnored} onCheckedChange={on => setIgnoredFiles(on ? "on" : "off")}>
                  {labels.showIgnoredFiles}
                </DropdownMenuCheckboxItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {explorer && <FilterChips filters={filters} onChange={changeFilters} labels={labels} columns={columns} />}
      <ManagerTree props={props} fm={fm} revealTick={revealTick} />
    </>
  );
}
