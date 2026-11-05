import type { FmMountInfo } from "../core/schema";

export interface FmMountGroup {
  driver: string;
  mounts: FmMountInfo[];
}

/** Mounts to show: drops host- and user-hidden ids, but never the current mount. Keeps order. */
export function visibleMounts(all: FmMountInfo[], hostHidden: readonly string[], userHidden: readonly string[], current: string | undefined) {
  const hidden = new Set([
    ...hostHidden,
    ...userHidden,
  ]);
  return all.filter(m => m.id === current || !hidden.has(m.id));
}

/** Groups mounts by driver kind, in order of first appearance. */
export function groupMountsByDriver(mounts: FmMountInfo[]): FmMountGroup[] {
  const groups = new Map<string, FmMountInfo[]>();
  for (const m of mounts) {
    const list = groups.get(m.driver);
    if (list)
      list.push(m);
    else
      groups.set(m.driver, [m]);
  }
  return [...groups].map(([driver, list]) => ({ driver, mounts: list }));
}

/** Parses a stored hidden list; anything but an array of strings reads as empty. */
export function parseHidden(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  }
  catch {
    return [];
  }
}
