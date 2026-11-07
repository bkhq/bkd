import type { FileManagerProps } from "./file-manager";
import type { FmController } from "./use-file-manager";

import { useMemo, useState } from "react";

import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { ScrollArea } from "@/components/ui/scroll-area";
import { dirname } from "../core/path";
import { FileTree } from "./file-tree";
import { viewportRef } from "./scroll";

/** The folder tree with its context menus, scrolled inside its own viewport. */
export function ManagerTree({ props, fm, revealTick = 0, onNavigate, group }: {
  props: FileManagerProps;
  fm: FmController;
  /** Bumping it scrolls the selected row (or the current folder) into view. */
  revealTick?: number;
  /** A folder or mount row was chosen (default: go there). */
  onNavigate?: (mount: string, path: string) => void;
  /** Mount grouping (default: `sidebar.group`). */
  group?: "none" | "driver" | "space" | undefined;
}) {
  const {
    drive,
    client,
    expanded,
    setNarrowPane,
    setDialog,
    treeTarget,
    setTreeTarget,
    path,
    inTrash,
    labels,
    features,
    mount,
    shownMounts,
    canManageDrives,
    setRowExpanded,
    filter,
    treeTargetRef,
    treeFilter,
    selected,
    changesOf,
    treeSections,
    go,
    navigate,
    reveal,
    dropEntries,
    menuContent,
    entryMenu,
    mountMenu,
  } = fm;
  // State, not a ref: the viewport is attached after FileTree's first layout effect (it is an
  // ancestor), so the tree must re-render to pick it up even when no data change follows.
  const [treeViewport, setTreeViewport] = useState<HTMLDivElement | null>(null);
  const treeViewportRef = useMemo(() => viewportRef<HTMLDivElement>(setTreeViewport), []);
  return (
    <ScrollArea
      className="min-h-0 flex-1"
      // The virtualized tree scrolls the viewport, not the root.
      ref={treeViewportRef}
    >
      {shownMounts && (
        <ContextMenu>
          <ContextMenuTrigger
            render={<div className="min-h-full" />}
            onContextMenu={(e) => {
              if (!treeTargetRef.current)
                e.preventBaseUIHandler();
              treeTargetRef.current = undefined;
            }}
          >
            <FileTree
              client={client}
              mounts={features.trash
                ? shownMounts
                : shownMounts.map(m => ({ ...m, trash: false }))}
              mount={mount}
              path={path}
              inTrash={inTrash}
              expanded={expanded}
              onExpandedChange={setRowExpanded}
              onNavigate={onNavigate ?? navigate}
              onOpenTrash={(m) => {
                go(m, "/", true);
                setNarrowPane("main");
              }}
              onRevealFile={(e) => {
                reveal(e);
                setNarrowPane("main");
              }}
              selected={selected.length === 1
                ? selected[0]!.path
                : undefined}
              onDropEntries={dropEntries}
              filter={filter}
              readOnlyLabel={labels.readOnly}
              trashLabel={labels.trash}
              group={group ?? props.sidebar?.group}
              drives={props.sidebar?.drives}
              groupLabel={labels.driverGroup}
              manageLabel={labels.manageDrives}
              onManage={canManageDrives
                ? () => setDialog({ kind: "manageDrives" })
                : undefined}
              scrollElement={treeViewport}
              revealTick={revealTick}
              filterEntries={treeFilter}
              changesOf={changesOf}
              sections={treeSections}
              foldersOnly={drive}
              onContextTarget={(target) => {
                treeTargetRef.current = target;
                setTreeTarget(target);
                // File menus act on the current folder (copy contents), so show the file first;
                // folder and mount menus target their row directly.
                if (target?.entry?.kind === "file")
                  reveal(target.entry);
              }}
            />
          </ContextMenuTrigger>
          {menuContent(treeTarget && (treeTarget.entry
            ? entryMenu([treeTarget.entry], treeTarget.entry.kind === "dir"
                ? {
                    mount: treeTarget.entry.mount,
                    path: dirname(treeTarget.entry.path),
                  }
                : undefined)
            : mountMenu(treeTarget.mount)))}
        </ContextMenu>
      )}
    </ScrollArea>
  );
}
