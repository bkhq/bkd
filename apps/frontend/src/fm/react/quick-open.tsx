import type { KeyboardEvent } from "react";
import type { FmClient, FmListFilter } from "../client/client";
import type { FmEntry } from "../core/schema";
import type { FmLabels } from "./labels";
import { cn } from "cn";
import { FileIcon, FolderIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSearch } from "../client/hooks";
import { dirname } from "../core/path";
import { MenuScroll } from "./menu-scroll";

export interface QuickOpenProps {
  client: FmClient;
  mount: string;
  labels: FmLabels;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (entry: FmEntry) => void;
  /** Hidden / ignored filter for the search. */
  filter?: FmListFilter | undefined;
}

/** Fuzzy "go to file" over the whole mount. */
export function QuickOpen({ client, mount, labels, open, onOpenChange, onPick, filter }: QuickOpenProps) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Handed over once the dialog has closed, so whatever the pick opens (a preview) gets the focus.
  const pickedRef = useRef<FmEntry>(undefined);

  useEffect(() => {
    const timer = setTimeout(setQuery, 150, input.trim());
    return () => clearTimeout(timer);
  }, [input]);

  const search = useSearch(client, mount, "/", query, open, "fuzzy", filter);
  const items = query
    ? search.data?.items ?? []
    : [];
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const change = (open: boolean) => {
    if (!open) {
      setInput("");
      setQuery("");
      setActive(0);
    }
    onOpenChange(open);
  };
  const pick = (e: FmEntry) => {
    pickedRef.current = e;
    change(false);
  };
  const closed = (open: boolean) => {
    const e = pickedRef.current;
    pickedRef.current = undefined;
    if (!open && e)
      onPick(e);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const n = items.length;
    switch (e.key) {
      case "ArrowDown":
        if (n)
          setActive((current + 1) % n);
        break;
      case "ArrowUp":
        if (n)
          setActive((current - 1 + n) % n);
        break;
      case "Enter":
        if (items[current])
          pick(items[current]);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={change} onOpenChangeComplete={closed}>
      <DialogContent className="gap-2 p-2 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">{labels.quickOpen}</DialogTitle>
        <Input
          autoFocus
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="fm-quick-open-list"
          aria-label={labels.quickOpen}
          placeholder={labels.quickOpenPlaceholder}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {items.length > 0
          ? (
              <MenuScroll className="-m-1">
                <ul id="fm-quick-open-list" role="listbox" aria-label={labels.quickOpen}>
                  {items.map((e, i) => {
                    const Icon = e.kind === "dir"
                      ? FolderIcon
                      : FileIcon;
                    return (
                      <li
                        key={e.path}
                        role="option"
                        aria-selected={i === current}
                        className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5", i === current && "bg-accent text-accent-foreground")}
                        onMouseMove={() => setActive(i)}
                        onClick={() => pick(e)}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{e.name}</span>
                        <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{dirname(e.path)}</span>
                      </li>
                    );
                  })}
                </ul>
              </MenuScroll>
            )
          : (
              <div className="px-2 py-6 text-center text-muted-foreground">
                {!query
                  ? labels.quickOpenHint
                  : search.isPending
                    ? labels.loading
                    : labels.noMatches}
              </div>
            )}
      </DialogContent>
    </Dialog>
  );
}
