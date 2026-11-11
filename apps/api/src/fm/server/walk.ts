import type { FmDriver, FmDriverEntry } from "./driver";

/** Which entries a walk leaves out; the router builds it from `hidden` and `authorize`. */
export interface FmWalkFilter {
  /** True leaves the entry and its subtree out. */
  skip: (entry: FmDriverEntry) => boolean;
  /** Asked before descending into a directory, roots included; false leaves it and its subtree out. */
  enter: (dir: FmDriverEntry) => Promise<boolean>;
}

/**
 * Walks `roots` and everything below them breadth first, so parents come
 * before their children. `visit` sees each root and each kept entry with the
 * root it belongs to; returning false stops the walk.
 */
export async function walk(
  driver: FmDriver,
  roots: FmDriverEntry[],
  filter: FmWalkFilter,
  visit: (entry: FmDriverEntry, root: FmDriverEntry) => boolean | void | Promise<boolean | void>,
): Promise<void> {
  const keep = async (e: FmDriverEntry) => !filter.skip(e) && (e.kind !== "dir" || await filter.enter(e));
  for (const root of roots) {
    if (!await keep(root))
      continue;
    if (await visit(root, root) === false)
      return;
    const queue = root.kind === "dir"
      ? [root.path]
      : [];
    while (queue.length > 0) {
      for (const e of await driver.list(queue.shift()!)) {
        if (!await keep(e))
          continue;
        if (await visit(e, root) === false)
          return;
        if (e.kind === "dir")
          queue.push(e.path);
      }
    }
  }
}
