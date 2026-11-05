import type { KeyboardEvent, MouseEvent } from "react";
import type { FmClient } from "../client/client";
import type { FmOpsResult, FmTrashItem } from "../core/schema";
import type { FmLabels } from "./labels";
import type { FmSelection } from "./state";
import { cn } from "cn";
import { ArchiveRestoreIcon, ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFmMutations, useTrash } from "../client/hooks";
import { dirname } from "../core/path";
import { useChangeMessage } from "./change-message";
import { ConfirmDeleteDialog } from "./dialogs";
import { EntryIcon } from "./file-list";
import { IconButton } from "./icon-button";
import { EMPTY_SELECTION, formatSize, select } from "./state";

type SortKey = "name" | "deletedAt";

const DAY_MS = 86_400_000;

/** Contents of a mount's trash: select rows (click, Ctrl / Shift, checkboxes) to restore or delete them forever. */
export function TrashView({ mount, mountLabel, retentionDays, client, labels, onError, onRestored }: {
  mount: string;
  mountLabel: string;
  retentionDays?: number | undefined;
  client: FmClient;
  labels: FmLabels;
  onError: (message: string | undefined) => void;
  onRestored: (count: number) => void;
}) {
  const trash = useTrash(client, mount);
  const { restore, purge } = useFmMutations(client, mount);
  const [confirm, setConfirm] = useState<string[]>();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "deletedAt", desc: true });
  const [selection, setSelection] = useState<FmSelection>(EMPTY_SELECTION);

  const items = useMemo(() => {
    const list = [
      ...trash.data ?? [],
    ];
    list.sort((a, b) => (sort.key === "name"
      ? a.name.localeCompare(b.name)
      : a.deletedAt.localeCompare(b.deletedAt)) * (sort.desc
      ? -1
      : 1));
    return list;
  }, [trash.data, sort]);
  const order = useMemo(() => items.map(i => i.id), [items]);
  // Ids that left the trash (restored, purged, expired) drop out of the selection.
  const selected = order.filter(id => selection.paths.has(id));
  const allSelected = items.length > 0 && selected.length === items.length;

  const report = (res: FmOpsResult) => {
    const failed = res.results.filter(r => !r.ok);
    onError(failed.length
      ? `${labels.failed(failed.length)}: ${failed[0]!.error?.message ?? ""}`
      : undefined);
    setSelection(EMPTY_SELECTION);
    return res.results.length - failed.length;
  };
  const { ask, used } = useChangeMessage();
  const onRestore = async (ids: string[]) => {
    const message = await ask();
    if (message === null)
      return;
    restore.mutate({ ids, message }, {
      onSuccess: (res) => {
        used();
        onRestored(report(res));
      },
      onError: e => onError(e.message),
    });
  };
  const onRowClick = (e: MouseEvent, id: string) => setSelection(s => select(s, id, e.shiftKey
    ? "range"
    : (e.metaKey || e.ctrlKey
        ? "toggle"
        : "single"), order));
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection({
        paths: new Set(order),
      });
    }
    else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
      e.preventDefault();
      setConfirm(selected);
    }
    else if (e.key === "Escape" && selected.length) {
      e.stopPropagation();
      setSelection(EMPTY_SELECTION);
    }
  };
  const sortHeader = (key: SortKey, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => setSort(s => ({
        key,
        desc: s.key === key
          ? !s.desc
          : key === "deletedAt",
      }))}
    >
      {label}
      {sort.key === key && (sort.desc
        ? <ArrowDownIcon className="size-3" />
        : <ArrowUpIcon className="size-3" />)}
    </button>
  );
  const daysLeft = (item: FmTrashItem) => item.expiresAt
    ? Math.max(0, Math.ceil((Date.parse(item.expiresAt) - Date.now()) / DAY_MS))
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      {retentionDays && (
        <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">{labels.trashRetention(retentionDays)}</div>
      )}
      {selected.length > 0 && (
        <div role="toolbar" aria-label={labels.selected(selected.length)} className="flex items-center gap-1 border-b bg-muted/40 px-3 py-1">
          <span className="mr-auto text-xs text-muted-foreground">{labels.selected(selected.length)}</span>
          <Button size="sm" variant="ghost" onClick={() => onRestore(selected)}>
            <ArchiveRestoreIcon />
            {labels.restore}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(selected)}>
            <Trash2Icon />
            {labels.deleteForever}
          </Button>
        </div>
      )}
      {items.length === 0
        ? (
            <div className="flex h-full min-h-40 items-center justify-center text-sm text-muted-foreground">
              {trash.isPending ? labels.loading : labels.trashIsEmpty}
            </div>
          )
        : (
            <ScrollArea className="min-h-0 flex-1">
              <table className="w-full text-sm select-none">
                <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground">
                  <tr className="border-b text-left">
                    <th className="w-8 pl-3">
                      <Checkbox
                        aria-label={labels.selectAll}
                        checked={allSelected}
                        indeterminate={selected.length > 0 && !allSelected}
                        onCheckedChange={on => setSelection(on
                          ? {
                              paths: new Set(order),
                            }
                          : EMPTY_SELECTION)}
                      />
                    </th>
                    <th className="px-3 py-1.5 font-normal">{sortHeader("name", labels.name)}</th>
                    <th className="px-3 py-1.5 font-normal">{labels.originalLocation}</th>
                    <th className="px-3 py-1.5 font-normal">{sortHeader("deletedAt", labels.deletedAt)}</th>
                    {retentionDays && <th className="px-3 py-1.5 font-normal">{labels.expires}</th>}
                    <th className="px-3 py-1.5 text-right font-normal">{labels.size}</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const on = selection.paths.has(item.id);
                    const left = daysLeft(item);
                    return (
                      <tr
                        key={item.id}
                        aria-selected={on}
                        className={cn("border-b last:border-0 hover:bg-muted/50", on && "bg-accent hover:bg-accent")}
                        data-trash-id={item.id}
                        onClick={e => onRowClick(e, item.id)}
                      >
                        <td className="pl-3" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            aria-label={item.name}
                            checked={on}
                            onCheckedChange={() => setSelection(s => select(s, item.id, "toggle", order))}
                          />
                        </td>
                        <td className="px-3 py-1">
                          <span className="flex items-center gap-2">
                            <EntryIcon entry={item} className="size-4" />
                            <span className="truncate">{item.name}</span>
                          </span>
                        </td>
                        <td className="truncate px-3 py-1 text-muted-foreground">
                          {`${mountLabel}${dirname(item.path) === "/"
                            ? ""
                            : dirname(item.path)}`}
                        </td>
                        <td className="px-3 py-1 text-muted-foreground">{new Date(item.deletedAt).toLocaleString()}</td>
                        {retentionDays && (
                          <td className="px-3 py-1 text-muted-foreground">
                            {left === undefined
                              ? ""
                              : labels.expiresIn(left)}
                          </td>
                        )}
                        <td className="px-3 py-1 text-right text-muted-foreground tabular-nums">
                          {item.kind === "file"
                            ? formatSize(item.size)
                            : "—"}
                        </td>
                        <td className="px-2 py-1" onClick={e => e.stopPropagation()}>
                          <span className="flex justify-end gap-1">
                            <IconButton size="icon-xs" label={labels.restore} onClick={() => onRestore([item.id])}><ArchiveRestoreIcon /></IconButton>
                            <IconButton size="icon-xs" label={labels.deleteForever} onClick={() => setConfirm([item.id])}><Trash2Icon /></IconButton>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          )}
      {confirm && (
        <ConfirmDeleteDialog
          count={confirm.length}
          labels={labels}
          onClose={() => setConfirm(undefined)}
          onConfirm={() => {
            setConfirm(undefined);
            void ask().then((message) => {
              if (message === null)
                return;
              purge.mutate({ ids: confirm, message }, {
                onSuccess: (res) => {
                  used();
                  report(res);
                },
                onError: e => onError(e.message),
              });
            });
          }}
        />
      )}
    </div>
  );
}
