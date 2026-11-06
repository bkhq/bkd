import type { FmColumn } from "./columns";
import type { FmListFilters } from "./filters";
import type { FmLabels } from "./labels";
import { cn } from "cn";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FILTER_KINDS, hasFilters, MODIFIED_RANGES, NO_FILTERS } from "./filters";

/** Type (checkboxes) and modified (radio) items for a dropdown menu or submenu. */
/** Filterable host columns with the values to offer. */
interface FmColumnFilterProps {
  columns?: readonly FmColumn[] | undefined;
  values?: Readonly<Record<string, readonly string[]>> | undefined;
}

export function FilterMenuItems({ filters, onChange, labels, columns, values }: { filters: FmListFilters; onChange: (f: FmListFilters) => void; labels: FmLabels } & FmColumnFilterProps) {
  const toggle = (id: string, value: string, on: boolean) => {
    const kept = (filters.extra?.[id] ?? []).filter(v => v !== value);
    onChange({
      ...filters,
      extra: {
        ...filters.extra,
        [id]: on
          ? [...kept, value]
          : kept,
      },
    });
  };
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{labels.filterType}</DropdownMenuLabel>
        {FILTER_KINDS.map(k => (
          <DropdownMenuCheckboxItem
            key={k}
            checked={filters.types.includes(k)}
            onCheckedChange={on => onChange({
              ...filters,
              types: on
                ? [...filters.types, k]
                : filters.types.filter(t => t !== k),
            })}
          >
            {labels.filterKinds[k]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{labels.filterModified}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={filters.modified} onValueChange={v => onChange({ ...filters, modified: v as FmListFilters["modified"] })}>
          {MODIFIED_RANGES.map(r => <DropdownMenuRadioItem key={r} value={r}>{labels.modifiedRanges[r]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      {(columns ?? []).filter(c => c.filter && values?.[c.id]?.length).map(c => (
        <DropdownMenuGroup key={c.id}>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{c.label}</DropdownMenuLabel>
          {values![c.id]!.map(v => (
            <DropdownMenuCheckboxItem key={v} checked={!!filters.extra?.[c.id]?.includes(v)} onCheckedChange={on => toggle(c.id, v, on)}>
              {v}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      ))}
      {hasFilters(filters) && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onChange(NO_FILTERS)}>{labels.clearFilters}</DropdownMenuItem>
        </>
      )}
    </>
  );
}

/** Active filters as removable chips; renders nothing without filters. */
export function FilterChips({ filters, onChange, labels, className, columns }: { filters: FmListFilters; onChange: (f: FmListFilters) => void; labels: FmLabels; className?: string } & Pick<FmColumnFilterProps, "columns">) {
  if (!hasFilters(filters))
    return null;
  const chip = (key: string, text: string, remove: () => void) => (
    <span key={key} className="inline-flex h-6 items-center gap-0.5 rounded-full border bg-muted/50 pr-0.5 pl-2 text-xs">
      {text}
      <button type="button" aria-label={labels.removeFilter(text)} className="rounded-full p-0.5 hover:bg-muted" onClick={remove}>
        <XIcon className="size-3" />
      </button>
    </span>
  );
  return (
    <div role="group" aria-label={labels.filter} className={cn("flex flex-wrap items-center gap-1 border-b px-2 py-1", className)}>
      {filters.types.map(k => chip(k, labels.filterKinds[k], () => onChange({
        ...filters,
        types: filters.types.filter(t => t !== k),
      })))}
      {filters.modified !== "any" && chip("modified", labels.modifiedRanges[filters.modified], () => onChange({ ...filters, modified: "any" }))}
      {Object.entries(filters.extra ?? {}).flatMap(([id, vs]) => vs.map(v => chip(`x-${id}-${v}`, `${columns?.find(c => c.id === id)?.label ?? id}: ${v}`, () => onChange({
        ...filters,
        extra: {
          ...filters.extra,
          [id]: vs.filter(x => x !== v),
        },
      }))))}
      <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => onChange(NO_FILTERS)}>{labels.clearFilters}</Button>
    </div>
  );
}
