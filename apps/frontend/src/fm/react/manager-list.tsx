import type { FmController } from "./use-file-manager";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { acceptsEntry } from "./accept";
import { FileList } from "./file-list";
import { NO_FILTERS } from "./filters";
import { EMPTY_SELECTION } from "./state";

/** The folder listing with its context menus. */
export function ManagerList({ fm, roomy }: { fm: FmController; roomy?: boolean }) {
  const {
    client,
    query,
    view,
    sort,
    setSort,
    setRawSelection,
    labels,
    mount,
    narrow,
    pick,
    listing,
    below,
    search,
    changeFilters,
    unfiltered,
    entries,
    selection,
    selected,
    changeIndex,
    currentMount,
    runOps,
    openEntry,
    onSelect,
    menuContent,
    entryMenu,
    blankMenu,
    columns,
  } = fm;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger
        render={<div className="flex min-h-0 flex-1 flex-col" />}
        onContextMenu={(e) => {
          if (!(e.target as HTMLElement).closest("[data-path]"))
            setRawSelection(EMPTY_SELECTION);
        }}
      >
        <FileList
          columns={columns}
          compact={narrow}
          roomy={roomy}
          menuOpen={menuOpen}
          entries={entries}
          view={view}
          selection={selection}
          labels={labels}
          client={client}
          sort={sort.key}
          order={sort.order}
          onSort={key => setSort(s => ({
            key,
            order: s.key === key && s.order === "asc"
              ? "desc"
              : "asc",
          }))}
          onSelect={onSelect}
          onClearSelection={() => setRawSelection(EMPTY_SELECTION)}
          onSelectPaths={pick && !pick.multiple
            ? undefined
            : paths => setRawSelection({
              paths: new Set(paths),
              anchor: paths[0],
            })}
          onOpen={openEntry}
          onEntryContextMenu={e => !selection.paths.has(e.path) && setRawSelection({
            paths: new Set([e.path]),
            anchor: e.path,
          })}
          onDropOnFolder={(paths, folder) => runOps({
            op: "move",
            paths,
            dest: folder.path,
            conflict: "rename",
          })}
          showParent={below}
          thumbnails={!!currentMount?.thumbnails}
          changes={mount
            ? changeIndex.get(mount)
            : undefined}
          hasMore={!below && !!listing.hasNextPage && !listing.isFetchingNextPage}
          onLoadMore={() => void listing.fetchNextPage()}
          disabled={pick && (e => e.kind === "file" && !acceptsEntry(e, pick.accept))}
          empty={(
            <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
              {(below
                ? search.isPending
                : listing.isPending)
                ? labels.loading
                : (unfiltered.length > 0
                    ? (
                        <span className="flex flex-col items-center gap-2">
                          {labels.noFilterMatches}
                          <Button size="sm" variant="outline" onClick={() => changeFilters(NO_FILTERS)}>{labels.clearFilters}</Button>
                        </span>
                      )
                    : query.trim()
                      ? labels.noMatches
                      : labels.emptyFolder)}
            </div>
          )}
        />
      </ContextMenuTrigger>
      {menuContent(selected.length
        ? entryMenu(selected)
        : blankMenu())}
    </ContextMenu>
  );
}
