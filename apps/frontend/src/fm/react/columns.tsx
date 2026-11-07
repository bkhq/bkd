import type { ReactNode } from "react";
import type { FmClient } from "../client/client";
import type { FmEntry } from "../core/schema";
import { useMemo } from "react";
import { columnValues } from "./filters";

/** A host column over `entry.extra[id]`, shown in the list view and the details panel. */
export interface FmColumn {
  /** Key in `entry.extra`. */
  id: string;
  label: string;
  /** Default: the value as text; `true` as ✓, `false` / null / missing as empty. */
  render?: (entry: FmEntry) => ReactNode;
  /** List cell width in px (default 120). */
  width?: number;
  /** Offer the column's values (of the loaded folder) in the filter menu. */
  filter?: boolean;
}

/** A host tab of the details panel (versions, shares, activity …). */
export interface FmDetailTab {
  id: string;
  label: string;
  /** Shown only when this returns true for the entry. */
  when?: (entry: FmEntry) => boolean;
  render: (entry: FmEntry, ctx: { client: FmClient; refresh: () => Promise<void> }) => ReactNode;
}

export function columnContent(column: FmColumn, entry: FmEntry): ReactNode {
  if (column.render)
    return column.render(entry);
  const v = entry.extra?.[column.id];
  if (v === true)
    return "✓";
  return v === false || v === null || v === undefined
    ? ""
    : String(v);
}

/** Values offered by the filter menu, per filterable column. */
export function useColumnValues(columns: readonly FmColumn[] | undefined, entries: readonly FmEntry[]) {
  return useMemo(() => Object.fromEntries((columns ?? [])
    .filter(c => c.filter)
    .map(c => [
      c.id,
      columnValues(entries, c.id),
    ])), [columns, entries]);
}
