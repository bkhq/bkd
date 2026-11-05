import type { FmChangeEntry } from "../core/schema";
import { dirname } from "../core/path";

/** Letter and colour per status, like VS Code's source control decorations. */
export const CHANGE_STYLE: Record<FmChangeEntry["status"], { letter: string; className: string }> = {
  added: { letter: "A", className: "text-emerald-600 dark:text-emerald-400" },
  modified: { letter: "M", className: "text-amber-600 dark:text-amber-400" },
  deleted: { letter: "D", className: "text-red-600 dark:text-red-400" },
  renamed: { letter: "R", className: "text-sky-600 dark:text-sky-400" },
  untracked: { letter: "U", className: "text-emerald-600 dark:text-emerald-400" },
};

export interface FmChangeIndex {
  byPath: ReadonlyMap<string, FmChangeEntry>;
  /** Folders with a change somewhere below. */
  dirs: ReadonlySet<string>;
}

export const NO_CHANGES: FmChangeIndex = {
  byPath: new Map(),
  dirs: new Set(),
};

export function indexChanges(changes: readonly FmChangeEntry[] | undefined): FmChangeIndex {
  if (!changes?.length)
    return NO_CHANGES;
  const dirs = new Set<string>();
  for (const c of changes) {
    for (let d = dirname(c.path); d !== "/"; d = dirname(d))
      dirs.add(d);
  }
  return {
    byPath: new Map(changes.map(c => [c.path, c])),
    dirs,
  };
}
