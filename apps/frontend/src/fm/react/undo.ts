import type { FmOpResult, FmOpsRequest } from "../core/schema";
import { basename, dirname } from "../core/path";

/** How to revert a finished batch: restore from the trash, or run inverse ops in order. */
export type FmUndo = { restore: string[] } | { ops: FmOpsRequest[] };

export function undoFor(req: FmOpsRequest, results: FmOpResult[]): FmUndo | undefined {
  const done = results.filter(r => r.ok);
  if (req.op === "delete") {
    const ids = done.flatMap(r => r.trashId ?? []);
    return ids.length
      ? { restore: ids }
      : undefined;
  }
  const moved = done.flatMap(r => (r.entry && r.entry.path !== r.path
    ? [
        { from: r.path, to: r.entry.path },
      ]
    : []));
  if (moved.length === 0)
    return undefined;
  if (req.op === "rename") {
    return {
      ops: [
        {
          op: "rename",
          path: moved[0]!.to,
          name: basename(moved[0]!.from),
        },
      ],
    };
  }
  if (req.op === "copy") {
    return {
      ops: [
        {
          op: "delete",
          paths: moved.map(m => m.to),
          permanent: true,
        },
      ],
    };
  }
  const byDir = new Map<string, string[]>();
  for (const m of moved) {
    byDir.set(dirname(m.from), [
      ...byDir.get(dirname(m.from)) ?? [],
      m.to,
    ]);
  }
  return {
    ops: [...byDir].map(([dest, paths]) => ({
      op: "move",
      paths,
      dest,
      conflict: "fail",
    })),
  };
}
